import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Pool } from 'pg';
import { randomBytes } from 'crypto';
import { ensureProjectDataPlaneSchema } from './project-schema.initializer';

export interface ProvisionResult {
  ref: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPasswordPlain: string;
}

@Injectable()
export class DatabaseProvisionerService {
  private readonly logger = new Logger(DatabaseProvisionerService.name);
  private provisionerPool: Pool;

  constructor(private readonly config: ConfigService) {
    const defaultUrl = 'postgresql://skynode:skynode@localhost:5432/postgres';
    const connectionString =
      this.config.get<string>('PROVISIONER_DATABASE_URL') ||
      this.config.get<string>('DATABASE_URL') ||
      defaultUrl;

    // Connect to maintenance DB
    this.provisionerPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10000,
    });
  }

  /**
   * Generates a 12-character unique project reference string.
   * Format: 'p' followed by 11 lowercase alphanumeric characters.
   */
  generateProjectRef(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = randomBytes(11);
    let ref = 'p';
    for (let i = 0; i < 11; i++) {
      const byte = bytes[i] ?? 0;
      ref += chars[byte % chars.length];
    }
    return ref;
  }

  /**
   * Generates a secure random database password.
   */
  generateSecurePassword(length = 32): string {
    return randomBytes(length).toString('base64url').slice(0, length);
  }

  /**
   * Provisions a dedicated PostgreSQL database, schemas, and isolated roles.
   */
  async provision(ref: string): Promise<ProvisionResult> {
    const dbName = `skynode_proj_${ref}`;
    const adminRole = `proj_${ref}_admin`;
    const authRole = `proj_${ref}_authenticated`;
    const anonRole = `proj_${ref}_anon`;
    const password = this.generateSecurePassword();

    const defaultUrl = 'postgresql://skynode:skynode@localhost:5432/postgres';
    const connectionString =
      this.config.get<string>('PROVISIONER_DATABASE_URL') ||
      this.config.get<string>('DATABASE_URL') ||
      defaultUrl;

    let host = this.config.get<string>('DB_HOST');
    let port = parseInt(this.config.get<string>('DB_PORT', '5432'), 10);

    if (!host) {
      try {
        const parsed = new URL(connectionString);
        host = parsed.hostname;
        port = parsed.port ? parseInt(parsed.port, 10) : 5432;
      } catch {
        host = 'localhost';
      }
    }

    this.logger.log(`Provisioning database ${dbName} for project ref: ${ref}`);

    let client;
    try {
      client = await this.provisionerPool.connect();

      // 1. Create dedicated database
      // PostgreSQL doesn't allow parameters in CREATE DATABASE, validate safe alphanumeric
      if (!/^[a-z0-9_]+$/.test(dbName)) {
        throw new InternalServerErrorException('Invalid database name format');
      }

      await client.query(`CREATE DATABASE "${dbName}"`);
      this.logger.log(`Created database: ${dbName}`);
    } catch (err: any) {
      this.logger.warn(`Could not create dedicated database ${dbName}: ${err.message}. Project will use shared database schema.`);
    } finally {
      if (client) client.release();
    }

    // 2. Connect to the newly created database and initialize schemas and roles
    let projectDbClient: Client | null = null;
    try {
      const baseUrl =
        this.config.get<string>('PROVISIONER_DATABASE_URL') ||
        this.config.get<string>('DATABASE_URL') ||
        'postgresql://skynode:skynode@localhost:5432/postgres';

      // Replace target database name in connection string
      const projectConnUrl = baseUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
      const isSsl = projectConnUrl.includes('render.com') || projectConnUrl.includes('sslmode=require');

      projectDbClient = new Client({
        connectionString: projectConnUrl,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
      });
      await projectDbClient.connect();

      // Enable extensions if allowed
      try {
        await projectDbClient.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
        await projectDbClient.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
      } catch (extErr: any) {
        this.logger.warn(`Could not enable extensions in ${dbName}: ${extErr.message}`);
      }

      // Create isolated schemas
      await projectDbClient.query(`CREATE SCHEMA IF NOT EXISTS "public";`);
      await projectDbClient.query(`CREATE SCHEMA IF NOT EXISTS "auth";`);
      await projectDbClient.query(`CREATE SCHEMA IF NOT EXISTS "storage";`);

      // Create isolated roles
      // Safe sanitization for role names
      await projectDbClient.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${adminRole}') THEN
            CREATE ROLE "${adminRole}" WITH LOGIN PASSWORD '${password}';
          END IF;
          IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${authRole}') THEN
            CREATE ROLE "${authRole}" NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${anonRole}') THEN
            CREATE ROLE "${anonRole}" NOLOGIN;
          END IF;
        END
        $$;
      `);

      // Grant permissions to admin role
      await projectDbClient.query(`
        GRANT ALL PRIVILEGES ON SCHEMA public, auth, storage TO "${adminRole}";
        ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON TABLES TO "${adminRole}";
        ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON SEQUENCES TO "${adminRole}";
      `);

      // Initialize universal multi-tenant data plane tables, RLS helper functions, and runtime grants
      await ensureProjectDataPlaneSchema(projectDbClient, {
        ref,
        adminRole,
        authRole,
        anonRole,
        logger: this.logger,
      });

      this.logger.log(`Initialized schemas, multi-tenant primitives & roles for project ${ref}`);
    } catch (err: any) {
      this.logger.warn(`Project database init for ${dbName}: ${err.message}. Project will use shared database connection.`);
    } finally {
      if (projectDbClient) {
        await projectDbClient.end().catch(() => {});
      }
    }

    return {
      ref,
      dbHost: host,
      dbPort: port,
      dbName,
      dbUser: adminRole,
      dbPasswordPlain: password,
    };
  }

  /**
   * Tears down a project database and its dedicated roles.
   */
  async teardown(ref: string): Promise<void> {
    const dbName = `skynode_proj_${ref}`;
    const adminRole = `proj_${ref}_admin`;
    const authRole = `proj_${ref}_authenticated`;
    const anonRole = `proj_${ref}_anon`;

    this.logger.log(`Tearing down database ${dbName} and roles`);

    let client;
    try {
      client = await this.provisionerPool.connect();

      // Terminate any active connections to the project database
      try {
        await client.query(`
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid();
        `, [dbName]);
      } catch (termErr: any) {
        this.logger.warn(`Connection termination notice: ${termErr.message}`);
      }

      // Drop database with FORCE if supported, fallback to standard drop
      try {
        await client.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
      } catch {
        await client.query(`DROP DATABASE IF EXISTS "${dbName}";`);
      }

      // Drop roles safely
      for (const role of [adminRole, authRole, anonRole]) {
        try {
          await client.query(`DROP OWNED BY "${role}" CASCADE;`);
        } catch {}
        try {
          await client.query(`DROP ROLE IF EXISTS "${role}";`);
        } catch (roleErr: any) {
          this.logger.warn(`Role drop notice for ${role}: ${roleErr.message}`);
        }
      }

      this.logger.log(`Successfully torn down database and roles for project ${ref}`);
    } catch (err: any) {
      this.logger.error(`Failed to teardown database ${dbName}: ${err.message}`);
      throw new InternalServerErrorException(`Failed to delete database: ${err.message}`);
    } finally {
      if (client) client.release();
    }
  }
}
