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
    if (key.startsWith(`${ref}:`)) {
      verifiedSchemas.delete(key);
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
  const cacheKey = `${options.ref ?? 'default'}:${options.adminRole ?? ''}`;

  if (!options.force && options.ref && verifiedSchemas.has(cacheKey)) {
    return;
  }

  const existingPromise = inFlightInits.get(cacheKey);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const initPromise = runSchemaInitWithLock(client, options, cacheKey);
  inFlightInits.set(cacheKey, initPromise);

  try {
    await initPromise;
  } finally {
    inFlightInits.delete(cacheKey);
  }
}

async function runSchemaInitWithLock(
  client: Pick<PoolClient, 'query'>,
  options: ProjectSchemaInitOptions,
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
    await client.query(`
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
    `);

    // 3. Universal Multi-Tenant Tables
    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.tenant_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES auth.tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_global_tenant_role_name
        ON auth.tenant_roles(name) WHERE tenant_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_scoped_tenant_role_name
        ON auth.tenant_roles(tenant_id, name) WHERE tenant_id IS NOT NULL;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.tenant_permissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role_id UUID NOT NULL REFERENCES auth.tenant_roles(id) ON DELETE CASCADE,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tenant_role_permission UNIQUE (role_id, resource, action)
      );
    `);

    await client.query(`
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
    `);

    await client.query(`
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
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.project_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Sessions (including tenant binding column for multi-tenant refresh persistence)
    await client.query(`
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
    `);

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
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON auth.sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON auth.tenants(status);
      CREATE INDEX IF NOT EXISTS idx_tenants_slug ON auth.tenants(slug);
      CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON auth.tenant_users(user_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON auth.tenant_users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_users_role_id ON auth.tenant_users(role_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_invitations_token ON auth.tenant_invitations(token);
      CREATE INDEX IF NOT EXISTS idx_tenant_invitations_email ON auth.tenant_invitations(email);
    `);

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
    await client.query(`
      CREATE OR REPLACE FUNCTION auth.jwt()
      RETURNS JSONB AS $$
      BEGIN
        RETURN COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::JSONB, '{}'::JSONB);
      EXCEPTION WHEN OTHERS THEN
        RETURN '{}'::JSONB;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS UUID AS $$
      BEGIN
        RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.tenant_id()
      RETURNS UUID AS $$
      BEGIN
        RETURN NULLIF(current_setting('request.jwt.claim.tenant_id', true), '')::UUID;
      EXCEPTION WHEN OTHERS THEN
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.role()
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
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.api_role()
      RETURNS TEXT AS $$
      BEGIN
        RETURN COALESCE(NULLIF(current_setting('request.jwt.claim.api_role', true), ''), 'anon');
      EXCEPTION WHEN OTHERS THEN
        RETURN 'anon';
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.is_service_role()
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN COALESCE(current_setting('request.jwt.claim.api_role', true), '') = 'service_role';
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION auth.is_tenant_member(target_tenant_id UUID DEFAULT auth.tenant_id())
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
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;

      CREATE OR REPLACE FUNCTION auth.has_permission(required_resource TEXT, required_action TEXT)
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
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;

      CREATE OR REPLACE FUNCTION auth.tenant_attribute(attr_key TEXT)
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
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = auth, pg_temp;
    `);

    // 8. Grant adminRole full ownership & access to auth schema tables/sequences/functions
    //    (Essential when StartupProvisioner / DatabaseProvisioner creates auth.* via superUrl)
    if (options.adminRole && /^[a-zA-Z0-9_]+$/.test(options.adminRole)) {
      const adminRole = options.adminRole;
      await client
        .query(
          `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${adminRole}') THEN
            GRANT ALL PRIVILEGES ON SCHEMA public, auth, storage TO "${adminRole}";
            GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO "${adminRole}";
            GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO "${adminRole}";
            GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA auth TO "${adminRole}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO "${adminRole}";
            ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO "${adminRole}";
            BEGIN
              ALTER SCHEMA auth OWNER TO "${adminRole}";
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
