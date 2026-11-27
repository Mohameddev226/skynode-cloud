import {
  Injectable,
  OnModuleDestroy,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

export interface ProjectDbCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  forceFallback?: boolean;
}

export interface TenantExecutionContext {
  apiRole: 'anon' | 'authenticated' | 'service_role';
  userId?: string | null;
  tenantId?: string | null;
  tenantRole?: string | null;
  claims?: Record<string, unknown>;
}

@Injectable()
export class ProjectConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(ProjectConnectionManager.name);
  private readonly pools = new Map<string, Pool>();
  private readonly unreachablePools = new Map<string, number>(); // key -> retryAfter timestamp
  private defaultPool: Pool | null = null;
  private defaultPoolSsl: boolean | undefined = undefined;

  constructor(private readonly config: ConfigService) {
    const mainUrl = this.config.get<string>('DATABASE_URL');
    if (mainUrl) {
      const isSsl = mainUrl.includes('render.com') || mainUrl.includes('sslmode=require');
      this.defaultPoolSsl = isSsl;
      this.defaultPool = this.createDefaultPool(mainUrl, isSsl);
    }
  }

  private createDefaultPool(mainUrl: string, useSsl: boolean): Pool {
    const pool = new Pool({
      connectionString: mainUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      this.logger.error(`Default pool error: ${err.message}`);
    });
    return pool;
  }

  hasFallbackPool(): boolean {
    return this.defaultPool !== null;
  }

  private resolveEffectiveEndpoint(credentials: ProjectDbCredentials): {
    host: string;
    port: number;
  } {
    let effectiveHost = credentials.host;
    let effectivePort = credentials.port;

    // Resolve localhost to cloud database host if deployed in production
    if (effectiveHost === 'localhost' || effectiveHost === '127.0.0.1') {
      const dbUrl =
        this.config.get<string>('DATABASE_URL') ||
        this.config.get<string>('PROVISIONER_DATABASE_URL');
      if (dbUrl && !dbUrl.includes('localhost') && !dbUrl.includes('127.0.0.1')) {
        try {
          const parsed = new URL(dbUrl);
          effectiveHost = parsed.hostname;
          effectivePort = parsed.port ? parseInt(parsed.port, 10) : 5432;
        } catch {
          // ignore parsing error
        }
      }
    }

    return { host: effectiveHost, port: effectivePort };
  }

  private getPoolKey(credentials: ProjectDbCredentials): string {
    const { host, port } = this.resolveEffectiveEndpoint(credentials);
    return `${host}:${port}/${credentials.database}/${credentials.user}`;
  }

  /**
   * Get or create a dedicated connection pool for a tenant project database.
   */
  getPool(credentials: ProjectDbCredentials): Pool {
    const { host: effectiveHost, port: effectivePort } =
      this.resolveEffectiveEndpoint(credentials);
    const key = `${effectiveHost}:${effectivePort}/${credentials.database}/${credentials.user}`;

    let pool = this.pools.get(key);
    if (!pool) {
      const dbUrl = this.config.get<string>('DATABASE_URL') ?? '';
      const isSsl =
        effectiveHost.includes('render.com') ||
        dbUrl.includes('sslmode=require') ||
        (effectiveHost.includes('.') && dbUrl.includes('render.com'));

      pool = new Pool({
        host: effectiveHost,
        port: effectivePort,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 4000,
      });

      pool.on('error', (err) => {
        this.logger.warn(`Pool error for database ${credentials.database}: ${err.message}`);
      });

      this.pools.set(key, pool);
      this.logger.debug(`Created connection pool for ${credentials.database}`);
    }

    return pool;
  }

  private async connectDefaultPool(): Promise<PoolClient> {
    if (!this.defaultPool) {
      throw new ServiceUnavailableException('No fallback database pool configured');
    }
    try {
      return await this.defaultPool.connect();
    } catch (err: any) {
      const msg = String(err?.message || '');
      const mainUrl = this.config.get<string>('DATABASE_URL');
      const looksLikeSslMismatch =
        msg.includes('SSL') ||
        msg.includes('pg_hba.conf') ||
        err?.code === 'ECONNRESET';

      if (mainUrl && looksLikeSslMismatch && this.defaultPoolSsl !== undefined) {
        this.logger.warn(`Retrying defaultPool with inverted SSL setting (${!this.defaultPoolSsl})`);
        const nextSsl = !this.defaultPoolSsl;
        await this.defaultPool.end().catch(() => {});
        this.defaultPoolSsl = nextSsl;
        this.defaultPool = this.createDefaultPool(mainUrl, nextSsl);
        return await this.defaultPool.connect();
      }
      throw err;
    }
  }

  /**
   * Acquires a connected client from the project pool, falling back to defaultPool ONLY
   * if establishing the direct project DB connection fails (e.g., on cloud single-DB hosting).
   */
  private async acquireClient(credentials: ProjectDbCredentials): Promise<PoolClient> {
    if (credentials.forceFallback && this.defaultPool) {
      return await this.connectDefaultPool();
    }

    const poolKey = this.getPoolKey(credentials);
    const retryAfter = this.unreachablePools.get(poolKey);
    if (retryAfter && Date.now() < retryAfter && this.defaultPool) {
      return await this.connectDefaultPool();
    }

    const pool = this.getPool(credentials);
    try {
      const client = await pool.connect();
      this.unreachablePools.delete(poolKey);
      return client;
    } catch (connErr: any) {
      this.logger.warn(
        `Direct tenant DB connection failed for ${credentials.database} (${connErr.message}). Attempting fallback to main database connection...`,
      );
      if (this.defaultPool) {
        // Cache unreachable project DBs for 5 minutes so concurrent/repeated requests don't stall
        this.unreachablePools.set(poolKey, Date.now() + 5 * 60 * 1000);
        return await this.connectDefaultPool();
      }
      throw connErr;
    }
  }

  /**
   * Executes a callback within a managed client connection for a project.
   * Query errors inside `fn` propagate normally without falling back to defaultPool.
   */
  async withClient<T>(
    credentials: ProjectDbCredentials,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.acquireClient(credentials);
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Executes a callback inside an explicit PostgreSQL transaction with
   * transaction-scoped JWT/tenant claims (`set_config(..., true)`) and
   * unprivileged runtime role switching (`SET LOCAL ROLE`).
   */
  async withTenantTransaction<T>(
    credentials: ProjectDbCredentials,
    projectRef: string,
    context: TenantExecutionContext,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.withClient(credentials, async (client) => {
      await client.query('BEGIN');
      try {
        const claimsPayload = JSON.stringify({
          sub: context.userId ?? null,
          tenant_id: context.tenantId ?? null,
          role: context.tenantRole ?? context.apiRole,
          api_role: context.apiRole,
          ...(context.claims ?? {}),
        });

        await client.query(
          `SELECT
            set_config('request.jwt.claim.sub', $1, true),
            set_config('request.jwt.claim.tenant_id', $2, true),
            set_config('request.jwt.claim.role', $3, true),
            set_config('request.jwt.claim.api_role', $4, true),
            set_config('request.jwt.claims', $5, true)`,
          [
            context.userId ?? '',
            context.tenantId ?? '',
            context.tenantRole ?? context.apiRole,
            context.apiRole,
            claimsPayload,
          ],
        );

        if (context.apiRole !== 'service_role') {
          const safeRef = projectRef.replace(/[^a-zA-Z0-9_]/g, '');
          const candidateRoles =
            context.apiRole === 'authenticated'
              ? [`proj_${safeRef}_authenticated`, 'authenticated']
              : [`proj_${safeRef}_anon`, 'anon'];

          let switched = false;
          for (const roleName of candidateRoles) {
            if (!/^[a-zA-Z0-9_]+$/.test(roleName)) continue;
            await client.query('SAVEPOINT skynode_role_sp');
            try {
              await client.query(`SET LOCAL ROLE "${roleName}"`);
              await client.query('RELEASE SAVEPOINT skynode_role_sp');
              switched = true;
              break;
            } catch {
              await client.query('ROLLBACK TO SAVEPOINT skynode_role_sp');
            }
          }

          if (!switched) {
            this.logger.debug(
              `Could not switch to unprivileged role for ${projectRef} (${context.apiRole}); running with injected session claims.`,
            );
          }
        }

        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }

  /**
   * Closes all active connection pools on shutdown.
   */
  async onModuleDestroy() {
    this.logger.log(`Closing ${this.pools.size} project connection pools`);
    for (const [key, pool] of this.pools.entries()) {
      try {
        await pool.end();
      } catch (err: any) {
        this.logger.warn(`Error closing pool ${key}: ${err.message}`);
      }
    }
    this.pools.clear();

    if (this.defaultPool) {
      await this.defaultPool.end().catch(() => {});
      this.defaultPool = null;
    }
  }
}
