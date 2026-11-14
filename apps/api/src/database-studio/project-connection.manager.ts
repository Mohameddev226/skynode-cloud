import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
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

  /**
   * Get or create a dedicated connection pool for a tenant project database.
   */
  getPool(credentials: ProjectDbCredentials): Pool {
    const key = `${credentials.host}:${credentials.port}/${credentials.database}/${credentials.user}`;

    let pool = this.pools.get(key);
    if (!pool) {
      pool = new Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
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
   */
  async withClient<T>(
    credentials: ProjectDbCredentials,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = this.getPool(credentials);
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
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
  }
}
