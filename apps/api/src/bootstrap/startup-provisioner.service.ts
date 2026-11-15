import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseProvisionerService } from '../projects/provisioning/database-provisioner.service';
import { decrypt } from '../common/utils/crypto.util';
import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';

/**
 * Runs once at API startup to ensure all stored projects have their
 * PostgreSQL roles, database, and schemas provisioned.
 * This is idempotent — safe to run repeatedly.
 */
@Injectable()
export class StartupProvisionerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupProvisionerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: DatabaseProvisionerService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Running startup project provisioner...');
    try {
      await this.ensureGlobalRoles();
      await this.ensureAllProjectsProvisioned();
    } catch (err: any) {
      this.logger.error(`Startup provisioner failed: ${err.message}`);
    }
  }

  /**
   * Ensure Supabase-compatible global roles exist at the cluster level.
   * These are needed for SQL like: GRANT SELECT TO anon;
   * or CREATE POLICY ... TO authenticated;
   */
  private async ensureGlobalRoles() {
    const superUrl =
      this.config.get<string>('PROVISIONER_DATABASE_URL') ||
      `postgresql://postgres:postgres_dev_password@localhost:5432/postgres`;
    const superClient = new Client({ connectionString: superUrl });
    await superClient.connect();

    const globalRoles = [
      { name: 'anon',           bypassRls: false },
      { name: 'authenticated',  bypassRls: false },
      { name: 'service_role',   bypassRls: true  },
      { name: 'supabase_admin', bypassRls: false },
    ];

    for (const role of globalRoles) {
      const exists = await superClient.query(
        'SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name]
      );
      if (exists.rowCount === 0) {
        const bypassStr = role.bypassRls ? 'BYPASSRLS' : '';
        await superClient.query(
          `CREATE ROLE "${role.name}" NOLOGIN NOINHERIT ${bypassStr}`
        );
        this.logger.log(`Created global role: ${role.name}`);
      }
    }

    await superClient.end();
  }

  private async ensureAllProjectsProvisioned() {
    const projects = await this.prisma.project.findMany({
      where: { status: { not: 'DELETED' } },
      select: {
        id: true,
        name: true,
        slug: true,
        ref: true,
        dbName: true,
        dbUser: true,
        dbPasswordEnc: true,
        dbHost: true,
        dbPort: true,
        status: true,
      },
    });

    if (projects.length === 0) {
      this.logger.log('No projects to provision.');
      return;
    }

    this.logger.log(`Checking ${projects.length} project(s)...`);

    const superUrl =
      this.config.get<string>('PROVISIONER_DATABASE_URL') ||
      `postgresql://postgres:postgres_dev_password@localhost:5432/postgres`;

    const superClient = new Client({ connectionString: superUrl });
    await superClient.connect();

    for (const project of projects) {
      try {
        const { ref, dbName, dbUser, dbPasswordEnc, name } = project;
        const dbPassword = decrypt(dbPasswordEnc);
        const authRole = `proj_${ref}_authenticated`;
        const anonRole = `proj_${ref}_anon`;

        // Ensure admin role
        await this.ensureRole(superClient, dbUser, true, dbPassword);
        await this.ensureRole(superClient, authRole, false, null);
        await this.ensureRole(superClient, anonRole, false, null);

        // Ensure database
        const dbExists = await superClient.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [dbName],
        );
        if (dbExists.rowCount === 0) {
          await superClient.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
          this.logger.log(`[${name}] Created database: ${dbName}`);
        }

        await superClient.query(
          `GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`,
        );

        // Connect to project DB and apply grants
        const pgSuperUser = this.config.get<string>('PG_SUPERUSER', 'postgres');
        const pgSuperPassword = this.config.get<string>('PG_SUPERUSER_PASSWORD', 'postgres_dev_password');
        const dbHost = this.config.get<string>('POSTGRES_HOST', 'localhost');
        const dbPort = this.config.get<number>('POSTGRES_PORT', 5432);

        const projClient = new Client({
          host: dbHost,
          port: dbPort,
          database: dbName,
          user: pgSuperUser,
          password: pgSuperPassword,
        });
        await projClient.connect();

        for (const ext of ['uuid-ossp', 'pgcrypto']) {
          await projClient
            .query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`)
            .catch(() => {});
        }

        for (const schema of ['public', 'auth', 'storage']) {
          await projClient.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        }

        await projClient.query(
          `GRANT ALL ON SCHEMA public, auth, storage TO "${dbUser}"`,
        );
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON TABLES TO "${dbUser}"`,
        );
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public, auth, storage GRANT ALL ON SEQUENCES TO "${dbUser}"`,
        );
        await projClient.query(
          `GRANT USAGE ON SCHEMA public TO "${authRole}", "${anonRole}"`,
        );
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${authRole}"`,
        );
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${anonRole}"`,
        );

        // Grant global Supabase-compatible roles into this project DB
        await projClient.query(
          `GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
        ).catch(() => {});
        await projClient.query(
          `GRANT ALL ON SCHEMA public TO service_role`,
        ).catch(() => {});
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon`,
        ).catch(() => {});
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated`,
        ).catch(() => {});
        await projClient.query(
          `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`,
        ).catch(() => {});

        await projClient.end();

        // Mark ACTIVE if not already
        if (project.status !== 'ACTIVE') {
          await this.prisma.project.update({
            where: { id: project.id },
            data: { status: 'ACTIVE' },
          });
        }

        this.logger.log(`[${name}] ✓ Provisioned OK`);
      } catch (err: any) {
        this.logger.error(
          `[${project.name}] Provisioning error: ${err.message}`,
        );
      }
    }

    await superClient.end();
    this.logger.log('Startup provisioner complete.');
  }

  private async ensureRole(
    client: Client,
    role: string,
    canLogin: boolean,
    password: string | null,
  ) {
    const exists = await client.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [role],
    );
    if (exists.rowCount === 0) {
      if (canLogin && password) {
        await client.query(
          `CREATE ROLE "${role}" WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`,
        );
      } else {
        await client.query(`CREATE ROLE "${role}" NOLOGIN`);
      }
    } else if (canLogin && password) {
      await client.query(
        `ALTER ROLE "${role}" WITH PASSWORD '${password.replace(/'/g, "''")}'`,
      );
    }
  }
}
