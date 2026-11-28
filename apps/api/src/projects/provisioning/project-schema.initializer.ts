import { Logger, InternalServerErrorException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface ProjectSchemaInitOptions {
  ref?: string;
  adminRole?: string;
  authRole?: string;
  anonRole?: string;
  logger?: Logger;
  force?: boolean;
}

// Tracks verified schemas per project/database context to eliminate redundant DDL on hot paths,
// and deduplicates concurrent initialization calls within the same Node.js process.
const verifiedSchemas = new Set<string>();
const inFlightInits = new Map<string, Promise<void>>();

export function clearProjectSchemaInitCache(ref?: string): void {
  if (!ref) {
    verifiedSchemas.clear();
    return;
  }
  for (const key of Array.from(verifiedSchemas)) {
    if (key === ref || key.startsWith(`${ref}:`)) {
      verifiedSchemas.delete(key);
    }
  }
}

function isInsufficientPrivilegeError(err: any): boolean {
  return err?.code === '42501';
}

async function isDataPlaneSchemaReady(client: Pick<PoolClient, 'query'>): Promise<boolean> {
  try {
    const catalogCheck = await client.query<{ ready: boolean }>(`
      SELECT (
        (SELECT COUNT(*) FROM information_schema.tables
         WHERE table_schema = 'auth'
           AND table_name IN (
             'users', 'tenants', 'tenant_roles', 'tenant_permissions',
             'tenant_users', 'tenant_invitations', 'project_settings', 'sessions'
           )) = 8
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'auth'
            AND table_name = 'sessions'
            AND column_name = 'active_tenant_id'
        )
        AND (SELECT COUNT(DISTINCT p.proname)
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'auth'
               AND p.proname IN (
                 'jwt', 'uid', 'tenant_id', 'role', 'api_role',
                 'is_service_role', 'is_tenant_member', 'has_permission', 'tenant_attribute'
               )) = 9
        AND EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'auth'
            AND tablename = 'tenant_roles'
            AND indexname = 'uq_global_tenant_role_name'
        )
      ) AS ready
    `);

    if (!catalogCheck.rows?.[0]?.ready) {
      return false;
    }

    const seedCheck = await client.query<{ seeded: boolean }>(`
      SELECT COUNT(*) >= 4 AS seeded
      FROM auth.tenant_roles
      WHERE tenant_id IS NULL
    `);
    return Boolean(seedCheck.rows?.[0]?.seeded);
  } catch {
    return false;
  }
}

async function ensureAuthTable(
  client: Pick<PoolClient, 'query'>,
  tableName: string,
  createSql: string,
  logger?: Logger,
): Promise<void> {
  try {
    await client.query(createSql);
  } catch (err: any) {
    if (!isInsufficientPrivilegeError(err)) {
      throw err;
    }
    const existsRes = await client
      .query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'auth' AND table_name = $1
         ) AS exists`,
        [tableName],
      )
      .catch(() => ({ rows: [{ exists: false }] }));

    if (existsRes.rows?.[0]?.exists) {
      logger?.debug(`Skipping CREATE TABLE auth.${tableName} (already exists under provisioner ownership)`);
      return;
    }
    throw err;
  }
}

async function runBatchWith42501Fallback(
  client: Pick<PoolClient, 'query'>,
  statements: string[],
  logger?: Logger,
  label = 'DDL',
): Promise<void> {
  try {
    await client.query(statements.join('\n'));
  } catch (err: any) {
    if (!isInsufficientPrivilegeError(err)) {
      throw err;
    }
    if (statements.length <= 1) {
      logger?.warn(`${label} notice (${err.message})`);
      return;
    }
    for (const stmt of statements) {
      try {
        await client.query(stmt);
      } catch (stmtErr: any) {
        if (isInsufficientPrivilegeError(stmtErr)) {
          logger?.warn(`${label} statement notice (${stmtErr.message})`);
        } else {
          throw stmtErr;
        }
      }
    }
  }
}

/**
 * Idempotently initializes or upgrades a SkyNode project database's
 * Data Plane schemas, universal multi-tenant tables, default roles,
 * PostgreSQL RLS helper functions, and least-privilege role grants.
 *
 * Uses both in-process Promise coalescing and PostgreSQL advisory locks
 * so concurrent requests (e.g. parallel dashboard loads) never collide on
 * `CREATE TABLE IF NOT EXISTS` or `CREATE OR REPLACE FUNCTION`.
 */
export async function ensureProjectDataPlaneSchema(
  client: Pick<PoolClient, 'query'>,
  options: ProjectSchemaInitOptions = {},
): Promise<void> {
  const schemaKey = options.ref ?? 'default';
  const cacheKey = options.adminRole ? `${schemaKey}:${options.adminRole}` : schemaKey;

  if (!options.force && options.ref && verifiedSchemas.has(cacheKey)) {
    return;
  }

  const existingPromise = inFlightInits.get(cacheKey) ?? inFlightInits.get(schemaKey);
  if (existingPromise) {
    await existingPromise;
    if (!options.force && options.ref && verifiedSchemas.has(cacheKey)) {
      return;
    }
  }

  const initPromise = runSchemaInitWithLock(client, options, schemaKey, cacheKey);
  inFlightInits.set(cacheKey, initPromise);
  if (cacheKey !== schemaKey) {
    inFlightInits.set(schemaKey, initPromise);
  }

  try {
    await initPromise;
  } finally {
    if (inFlightInits.get(cacheKey) === initPromise) {
      inFlightInits.delete(cacheKey);
    }
    if (inFlightInits.get(schemaKey) === initPromise) {
      inFlightInits.delete(schemaKey);
    }
  }
}

async function runSchemaInitWithLock(
  client: Pick<PoolClient, 'query'>,
  options: ProjectSchemaInitOptions,
  schemaKey: string,
  cacheKey: string,
): Promise<void> {
  const logger = options.logger;
  let lockAcquired = false;

  // Serialize schema DDL across processes/connections using PostgreSQL advisory lock
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('skynode_data_plane_schema_init'))`);
    lockAcquired = true;
  } catch {
    // Non-fatal in mocked unit tests or DB environments disallowing advisory locks
  }

  try {
    // Fast path for runtime requests when provisioner has already initialized the project DB
    if (!options.force && !options.adminRole) {
      const ready = await isDataPlaneSchemaReady(client);
      if (ready) {
        if (options.ref) {
          verifiedSchemas.add(schemaKey);
          verifiedSchemas.add(cacheKey);
        }
        return;
      }
    }

    // Ensure provisioner inherits adminRole if adminRole already owns objects from a prior run
    if (options.adminRole && /^[a-zA-Z0-9_]+$/.test(options.adminRole)) {
      const adminRole = options.adminRole;
      await client
        .query(
          `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${adminRole}')
             AND current_user <> '${adminRole}' THEN
            EXECUTE format('GRANT %I TO %I', '${adminRole}', current_user);
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END
        $$;
      `,
        )
        .catch(() => {});
    }

    // 1. Schemas & Extensions
    await client.query(`CREATE SCHEMA IF NOT EXISTS "public";`).catch(() => {});
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS "auth";`);
    } catch (schemaErr: any) {
      // Verify whether auth schema already exists despite CREATE SCHEMA lacking DB-level CREATE priv
      const check = await client
        .query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') AS exists`,
        )
        .catch(() => ({ rows: [{ exists: false }] }));

      if (!check.rows[0]?.exists) {
        logger?.error(`Failed to create or access auth schema: ${schemaErr.message}`);
        throw new InternalServerErrorException(
          `Database permission error: cannot create or access the "auth" schema (${schemaErr.message})`,
        );
      }
    }

    await client.query(`CREATE SCHEMA IF NOT EXISTS "storage";`).catch(() => {});
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`).catch(() => {});
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`).catch(() => {});

    // 2. Core App Auth Tables
    await ensureAuthTable(
      client,
      'users',
      `
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        email_confirmed_at TIMESTAMPTZ,
        encrypted_password TEXT NOT NULL,
        full_name TEXT,
        avatar_url TEXT,
        is_banned BOOLEAN NOT NULL DEFAULT FALSE,
        banned_until TIMESTAMPTZ,
        last_sign_in_at TIMESTAMPTZ,
        reset_password_token TEXT,
        reset_password_sent_at TIMESTAMPTZ,
        confirmation_token TEXT,
        confirmation_sent_at TIMESTAMPTZ,
        raw_user_meta_data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    // 3. Universal Multi-Tenant Tables
    await ensureAuthTable(
      client,
      'tenants',
      `
      CREATE TABLE IF NOT EXISTS auth.tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
        plan TEXT NOT NULL DEFAULT 'STANDARD',
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    await ensureAuthTable(
      client,
      'tenant_roles',
      `
      CREATE TABLE IF NOT EXISTS auth.tenant_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES auth.tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    await runBatchWith42501Fallback(
      client,
      [
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_global_tenant_role_name ON auth.tenant_roles(name) WHERE tenant_id IS NULL;`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_scoped_tenant_role_name ON auth.tenant_roles(tenant_id, name) WHERE tenant_id IS NOT NULL;`,
      ],
      logger,
      'Tenant role unique index init',
    );

    await ensureAuthTable(
      client,
      'tenant_permissions',
      `
      CREATE TABLE IF NOT EXISTS auth.tenant_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES auth.tenant_roles(id) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_role_permission UNIQUE (role_id, resource, action)
      );
    `,
      logger,
    );

    await ensureAuthTable(
      client,
      'tenant_users',
      `
      CREATE TABLE IF NOT EXISTS auth.tenant_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES auth.tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES auth.tenant_roles(id) ON DELETE RESTRICT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED')),
        custom_attributes JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_user UNIQUE (tenant_id, user_id)
      );
    `,
      logger,
    );

    await ensureAuthTable(
      client,
      'tenant_invitations',
      `
      CREATE TABLE IF NOT EXISTS auth.tenant_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES auth.tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role_id UUID NOT NULL REFERENCES auth.tenant_roles(id) ON DELETE RESTRICT,
        invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        custom_attributes JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    await ensureAuthTable(
      client,
      'project_settings',
      `
      CREATE TABLE IF NOT EXISTS auth.project_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    // 4. Sessions (including tenant binding column for multi-tenant refresh persistence)
    await ensureAuthTable(
      client,
      'sessions',
      `
      CREATE TABLE IF NOT EXISTS auth.sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        active_tenant_id UUID REFERENCES auth.tenants(id) ON DELETE SET NULL,
        refresh_token TEXT UNIQUE NOT NULL,
        refresh_token_expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
      logger,
    );

    // Upgrade existing auth.sessions tables cleanly
    await client
      .query(
        `
      ALTER TABLE auth.sessions
        ADD COLUMN IF NOT EXISTS active_tenant_id UUID REFERENCES auth.tenants(id) ON DELETE SET NULL;
    `,
      )
      .catch(() => {});

    // 5. Indexes
    await runBatchWith42501Fallback(
      client,
      [
        `CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON auth.sessions(refresh_token);`,
        `CREATE INDEX IF NOT EXISTS idx_tenants_status ON auth.tenants(status);`,
        `CREATE INDEX IF NOT EXISTS idx_tenants_slug ON auth.tenants(slug);`,
        `CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON auth.tenant_users(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON auth.tenant_users(tenant_id);`,
        `CREATE INDEX IF NOT EXISTS idx_tenant_users_role_id ON auth.tenant_users(role_id);`,
        `CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON auth.tenant_invitations(token);`,
        `CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON auth.tenant_invitations(email);`,
      ],
      logger,
      'Auth index init',
    );

    // 6. Seed Default Universal System Roles & Permissions (Idempotent)
    await client
      .query(
        `
      DO $$
      DECLARE
        v_owner_id UUID;
        v_admin_id UUID;
        v_member_id UUID;
        v_viewer_id UUID;
      BEGIN
        INSERT INTO auth.tenant_roles (tenant_id, name, description, is_system)
        VALUES
          (NULL, 'owner', 'Full administrative ownership of a tenant', TRUE),
          (NULL, 'admin', 'Manage tenant resources, settings, and members', TRUE),
          (NULL, 'member', 'Standard authenticated tenant member', TRUE),
          (NULL, 'viewer', 'Read-only tenant access', TRUE)
        ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

        SELECT id INTO v_owner_id FROM auth.tenant_roles WHERE tenant_id IS NULL AND name = 'owner';
        SELECT id INTO v_admin_id FROM auth.tenant_roles WHERE tenant_id IS NULL AND name = 'admin';
        SELECT id INTO v_member_id FROM auth.tenant_roles WHERE tenant_id IS NULL AND name = 'member';
        SELECT id INTO v_viewer_id FROM auth.tenant_roles WHERE tenant_id IS NULL AND name = 'viewer';

        IF v_owner_id IS NOT NULL THEN
          INSERT INTO auth.tenant_permissions (role_id, resource, action)
          VALUES (v_owner_id, '*', '*') ON CONFLICT DO NOTHING;
        END IF;

        IF v_admin_id IS NOT NULL THEN
          INSERT INTO auth.tenant_permissions (role_id, resource, action)
          VALUES (v_admin_id, '*', '*') ON CONFLICT DO NOTHING;
        END IF;

        IF v_member_id IS NOT NULL THEN
          INSERT INTO auth.tenant_permissions (role_id, resource, action)
          VALUES
            (v_member_id, '*', 'read'),
            (v_member_id, '*', 'create'),
            (v_member_id, '*', 'update')
          ON CONFLICT DO NOTHING;
        END IF;

        IF v_viewer_id IS NOT NULL THEN
          INSERT INTO auth.tenant_permissions (role_id, resource, action)
          VALUES (v_viewer_id, '*', 'read')
          ON CONFLICT DO NOTHING;
        END IF;
      END
      $$;
    `,
      )
      .catch((err: any) => {
        logger?.warn(`Default tenant role seeding notice: ${err.message}`);
      });

    // 7. Universal PostgreSQL RLS Helper Functions
    await runBatchWith42501Fallback(
      client,
      [
        `CREATE OR REPLACE FUNCTION auth.jwt()
        RETURNS JSONB AS $$
        BEGIN
          RETURN COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::JSONB, '{}'::JSONB);
        EXCEPTION WHEN OTHERS THEN
          RETURN '{}'::JSONB;
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.uid()
        RETURNS UUID AS $$
        BEGIN
          RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
        EXCEPTION WHEN OTHERS THEN
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.tenant_id()
        RETURNS UUID AS $$
        BEGIN
          RETURN NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::UUID;
        EXCEPTION WHEN OTHERS THEN
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.role()
        RETURNS TEXT AS $$
        BEGIN
          RETURN COALESCE(
            NULLIF(current_setting('request.jwt.claim.role', true), ''),
            NULLIF(current_setting('request.jwt.claim.api_role', true), ''),
            'anon'
          );
        EXCEPTION WHEN OTHERS THEN
          RETURN 'anon';
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.api_role()
        RETURNS TEXT AS $$
        BEGIN
          RETURN COALESCE(NULLIF(current_setting('request.jwt.claim.api_role', true), ''), 'anon');
        EXCEPTION WHEN OTHERS THEN
          RETURN 'anon';
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.is_service_role()
        RETURNS BOOLEAN AS $$
        BEGIN
          RETURN COALESCE(current_setting('request.jwt.claim.api_role', true), '') = 'service_role';
        EXCEPTION WHEN OTHERS THEN
          RETURN FALSE;
        END;
        $$ LANGUAGE plpgsql STABLE;`,

        `CREATE OR REPLACE FUNCTION auth.is_tenant_member(target_tenant_id UUID DEFAULT auth.tenant_id())
        RETURNS BOOLEAN AS $$
        DECLARE
          v_uid UUID := auth.uid();
          v_member BOOLEAN;
        BEGIN
          IF auth.is_service_role() THEN
            RETURN TRUE;
          END IF;
          IF v_uid IS NULL OR target_tenant_id IS NULL THEN
            RETURN FALSE;
          END IF;

          SELECT EXISTS (
            SELECT 1
            FROM auth.tenant_users tu
            JOIN auth.tenants t ON t.id = tu.tenant_id
            WHERE tu.user_id = v_uid
              AND tu.tenant_id = target_tenant_id
              AND tu.status = 'ACTIVE'
              AND t.status = 'ACTIVE'
          ) INTO v_member;

          RETURN COALESCE(v_member, FALSE);
        END;
        $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;`,

        `CREATE OR REPLACE FUNCTION auth.has_permission(required_resource TEXT, required_action TEXT)
        RETURNS BOOLEAN AS $$
        DECLARE
          v_uid UUID := auth.uid();
          v_tid UUID := auth.tenant_id();
          v_allowed BOOLEAN;
        BEGIN
          IF auth.is_service_role() THEN
            RETURN TRUE;
          END IF;
          IF v_uid IS NULL OR v_tid IS NULL THEN
            RETURN FALSE;
          END IF;

          SELECT EXISTS (
            SELECT 1
            FROM auth.tenant_users tu
            JOIN auth.tenants t ON t.id = tu.tenant_id
            JOIN auth.tenant_permissions tp ON tp.role_id = tu.role_id
            WHERE tu.user_id = v_uid
              AND tu.tenant_id = v_tid
              AND tu.status = 'ACTIVE'
              AND t.status = 'ACTIVE'
              AND (tp.resource = required_resource OR tp.resource = '*')
              AND (tp.action = required_action OR tp.action = '*')
          ) INTO v_allowed;

          RETURN COALESCE(v_allowed, FALSE);
        END;
        $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;`,

        `CREATE OR REPLACE FUNCTION auth.tenant_attribute(attr_key TEXT)
        RETURNS TEXT AS $$
        DECLARE
          v_uid UUID := auth.uid();
          v_tid UUID := auth.tenant_id();
          v_val TEXT;
        BEGIN
          IF v_uid IS NULL OR v_tid IS NULL THEN
            RETURN NULL;
          END IF;

          SELECT tu.custom_attributes ->> attr_key
          INTO v_val
          FROM auth.tenant_users tu
          WHERE tu.user_id = v_uid
            AND tu.tenant_id = v_tid
            AND tu.status = 'ACTIVE';

          RETURN v_val;
        END;
        $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;`,
      ],
      logger,
      'Auth RLS helper function init',
    );

    // 8. Transfer ownership of auth schema, tables, sequences & functions to adminRole
    //    (Essential when StartupProvisioner / DatabaseProvisioner creates auth.* via superUrl)
    if (options.adminRole && /^[a-zA-Z0-9_]+$/.test(options.adminRole)) {
      const adminRole = options.adminRole;
      await client
        .query(
          `
        DO $$
        DECLARE
          v_admin TEXT := '${adminRole}';
          r RECORD;
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_admin) THEN
            IF current_user <> v_admin THEN
              BEGIN
                EXECUTE format('GRANT %I TO %I', v_admin, current_user);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END IF;

            BEGIN
              EXECUTE format('GRANT ALL PRIVILEGES ON SCHEMA public, auth, storage TO %I', v_admin);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;

            BEGIN
              EXECUTE format('ALTER SCHEMA auth OWNER TO %I', v_admin);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;

            BEGIN
              EXECUTE format('ALTER SCHEMA storage OWNER TO %I', v_admin);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;

            FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth' LOOP
              BEGIN
                EXECUTE format('ALTER TABLE auth.%I OWNER TO %I', r.tablename, v_admin);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END LOOP;

            FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'auth' LOOP
              BEGIN
                EXECUTE format('ALTER SEQUENCE auth.%I OWNER TO %I', r.sequence_name, v_admin);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END LOOP;

            FOR r IN
              SELECT p.oid::regprocedure::text AS sig
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'auth'
            LOOP
              BEGIN
                EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.sig, v_admin);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END LOOP;

            BEGIN
              EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO %I', v_admin);
              EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO %I', v_admin);
              EXECUTE format('GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA auth TO %I', v_admin);
              ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO "${adminRole}";
              ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO "${adminRole}";
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
          END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END
        $$;
      `,
        )
        .catch(() => {});
    }

    // 9. Grant runtime privileges cleanly (safe against restricted managed Postgres)
    const runtimeRoles = new Set<string>(['authenticated', 'anon']);
    if (options.authRole) runtimeRoles.add(options.authRole);
    if (options.anonRole) runtimeRoles.add(options.anonRole);
    if (options.ref) {
      runtimeRoles.add(`proj_${options.ref}_authenticated`);
      runtimeRoles.add(`proj_${options.ref}_anon`);
    }

    for (const role of runtimeRoles) {
      if (!/^[a-zA-Z0-9_]+$/.test(role)) continue;
      const isAnon = role === 'anon' || role.endsWith('_anon');

      await client
        .query(
          `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
            BEGIN
              EXECUTE format('GRANT %I TO %I', '${role}', current_user);
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
            ${
              options.adminRole && /^[a-zA-Z0-9_]+$/.test(options.adminRole)
                ? `
            BEGIN
              EXECUTE format('GRANT %I TO %I', '${role}', '${options.adminRole}');
            EXCEPTION WHEN OTHERS THEN NULL;
            END;`
                : ''
            }
            GRANT USAGE ON SCHEMA auth TO "${role}";
            GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO "${role}";
            GRANT USAGE ON SCHEMA public TO "${role}";
            ${
              isAnon
                ? `GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}";`
                : `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}";
                   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}";`
            }
          END IF;
        END
        $$;
      `,
        )
        .catch((err: any) => {
          logger?.debug(`Runtime role grant check for ${role}: ${err.message}`);
        });
    }

    if (
      options.adminRole &&
      options.authRole &&
      options.anonRole &&
      [options.adminRole, options.authRole, options.anonRole].every((r) =>
        /^[a-zA-Z0-9_]+$/.test(r),
      )
    ) {
      await client
        .query(
          `
        DO $$
        BEGIN
          ALTER DEFAULT PRIVILEGES FOR ROLE "${options.adminRole}" IN SCHEMA public
            GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${options.authRole}";
          ALTER DEFAULT PRIVILEGES FOR ROLE "${options.adminRole}" IN SCHEMA public
            GRANT USAGE, SELECT ON SEQUENCES TO "${options.authRole}";
          ALTER DEFAULT PRIVILEGES FOR ROLE "${options.adminRole}" IN SCHEMA public
            GRANT SELECT ON TABLES TO "${options.anonRole}";
        EXCEPTION WHEN OTHERS THEN NULL;
        END
        $$;
      `,
        )
        .catch(() => {});
    }

    if (options.ref) {
      verifiedSchemas.add(schemaKey);
      verifiedSchemas.add(cacheKey);
    }
  } finally {
    if (lockAcquired) {
      await client
        .query(`SELECT pg_advisory_unlock(hashtext('skynode_data_plane_schema_init'))`)
        .catch(() => {});
    }
  }
}
