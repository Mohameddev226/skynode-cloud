import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

export interface ProjectDbCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

@Injectable()
export class ProjectConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(ProjectConnectionManager.name);
  private readonly pools = new Map<string, Pool>();
  private defaultPool: Pool | null = null;

  constructor(private readonly config: ConfigService) {
    const mainUrl = this.config.get<string>('DATABASE_URL');
    if (mainUrl) {
      const isSsl = mainUrl.includes('render.com') || mainUrl.includes('sslmode=require');
      this.defaultPool = new Pool({
        connectionString: mainUrl,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      this.defaultPool.on('error', (err) => {
        this.logger.error(`Default pool error: ${err.message}`);
      });
    }
  }

  /**
   * Get or create a dedicated connection pool for a tenant project database.
   */
  getPool(credentials: ProjectDbCredentials): Pool {
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

    const key = `${effectiveHost}:${effectivePort}/${credentials.database}/${credentials.user}`;

    let pool = this.pools.get(key);
    if (!pool) {
      const dbUrl = this.config.get<string>('DATABASE_URL') ?? '';
      const isSsl =
        effectiveHost.includes('render.com') ||
        dbUrl.includes('sslmode=require') ||
        dbUrl.includes('render.com');

      pool = new Pool({
        host: effectiveHost,
        port: effectivePort,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      pool.on('error', (err) => {
        this.logger.error(`Pool error for database ${credentials.database}: ${err.message}`);
      });

      this.pools.set(key, pool);
      this.logger.debug(`Created connection pool for ${credentials.database}`);
    }

    return pool;
  }

  /**
   * Executes a callback within a managed client connection for a project.
   * If tenant-specific database or credentials fail (e.g., on cloud single-DB hosting),
   * falls back to the default database connection.
   */
  async withClient<T>(
    credentials: ProjectDbCredentials,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPool(credentials);
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      return await fn(client);
    } catch (err: any) {
      this.logger.warn(
        `Direct tenant DB connection failed for ${credentials.database} (${err.message}). Attempting fallback to main database connection...`,
      );
      if (this.defaultPool) {
        const fallbackClient = await this.defaultPool.connect();
        try {
          return await fn(fallbackClient);
        } finally {
          fallbackClient.release();
        }
      }
      throw err;
    } finally {
      if (client) {
        client.release();
      }
    }
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
