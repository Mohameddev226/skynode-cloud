import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseProvisionerService } from '../projects/provisioning/database-provisioner.service';
import { decrypt } from '../common/utils/crypto.util';
import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';

/**
 * Runs once at API startup to ensure:
 * 1. Database schema and tables (e.g. platform_users) exist.
 * 2. Supabase-compatible roles exist.
 * 3. All stored projects have their databases/schemas provisioned.
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
      await this.ensureDatabaseSchema();
      await this.ensureGlobalRoles();
      await this.ensureAllProjectsProvisioned();
    } catch (err: any) {
      this.logger.warn(`Startup provisioner completed with warning: ${err.message}`);
    }
  }

  /**
   * Check if main tables exist in the database. If not, automatically
   * run Prisma db push to generate all tables (platform_users, sessions, etc.).
   */
  private async ensureDatabaseSchema() {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM platform_users LIMIT 1`;
      this.logger.log('Database tables already exist. Skipping schema push.');
    } catch {
      this.logger.log('Database tables missing or uninitialized. Running prisma db push...');
      const possiblePaths = [
        path.join(process.cwd(), 'prisma', 'schema.prisma'),
        path.join(process.cwd(), 'apps', 'api', 'prisma', 'schema.prisma'),
        path.join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
      ];
      const schemaPath = possiblePaths.find((p) => fs.existsSync(p));
      if (schemaPath) {
        this.logger.log(`Pushing Prisma schema from: ${schemaPath}`);
        try {
          execSync(`npx prisma db push --schema="${schemaPath}" --accept-data-loss`, {
            stdio: 'inherit',
            env: process.env,
          });
          this.logger.log('✓ Prisma schema pushed successfully! All tables created.');
        } catch (pushErr: any) {
          this.logger.error(`Prisma db push execution failed: ${pushErr.message}`);
        }
      } else {
        this.logger.warn('Could not locate schema.prisma for automatic DB push.');
      }
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
      this.config.get<string>('DATABASE_URL');

    if (!superUrl || superUrl.includes('localhost:5432')) {
      this.logger.log('PROVISIONER_DATABASE_URL not set for local cluster, skipping global roles');
      return;
    }

    let superClient: Client | null = null;
    try {
      const isSsl = superUrl.includes('render.com') || superUrl.includes('sslmode=require');
      superClient = new Client({
        connectionString: superUrl,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
      });
      await superClient.connect();

      const globalRoles = [
        { name: 'anon',           bypassRls: false },
        { name: 'authenticated',  bypassRls: false },
        { name: 'service_role',   bypassRls: true  },
        { name: 'supabase_admin', bypassRls: false },
      ];

      for (const role of globalRoles) {
        try {
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
        } catch (roleErr: any) {
          this.logger.warn(`Could not provision global role ${role.name}: ${roleErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Global roles check skipped: ${err.message}`);
    } finally {
      if (superClient) {
        await superClient.end().catch(() => {});
      }
    }
  }

  private async ensureAllProjectsProvisioned() {
    let projects: any[] = [];
    try {
      projects = await this.prisma.project.findMany({
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
    } catch (dbErr: any) {
      this.logger.warn(`Could not query projects from database: ${dbErr.message}`);
      return;
    }

    if (projects.length === 0) {
      this.logger.log('No projects to provision.');
      return;
    }

    this.logger.log(`Checking ${projects.length} project(s)...`);

    const superUrl =
      this.config.get<string>('PROVISIONER_DATABASE_URL') ||
      this.config.get<string>('DATABASE_URL');

    if (!superUrl || superUrl.includes('localhost:5432')) {
      this.logger.log('PROVISIONER_DATABASE_URL not set for local cluster, skipping project re-provisioning');
      return;
    }

    let superClient: Client | null = null;
    try {
      const isSsl = superUrl.includes('render.com') || superUrl.includes('sslmode=require');
      superClient = new Client({
        connectionString: superUrl,
        ssl: isSsl ? { rejectUnauthorized: false } : undefined,
      });
      await superClient.connect();

      for (const project of projects) {
        try {
          const { ref, dbName, dbUser, dbPasswordEnc, name } = project;
          const dbPassword = decrypt(dbPasswordEnc);
          const authRole = `proj_${ref}_authenticated`;
          const anonRole = `proj_${ref}_anon`;

          // Ensure roles
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

          if (project.status !== 'ACTIVE') {
            await this.prisma.project.update({
              where: { id: project.id },
              data: { status: 'ACTIVE' },
            });
          }
          this.logger.log(`[${name}] ✓ Provisioned OK`);
        } catch (err: any) {
          this.logger.warn(`Failed to provision project ${project.name}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Projects check skipped: ${err.message}`);
    } finally {
      if (superClient) {
        await superClient.end().catch(() => {});
      }
    }
  }

  private async ensureRole(
    client: Client,
    role: string,
    canLogin: boolean,
    password: string | null,
  ) {
    try {
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
    } catch (err: any) {
      this.logger.warn(`Could not manage role ${role}: ${err.message}`);
    }
  }
}
