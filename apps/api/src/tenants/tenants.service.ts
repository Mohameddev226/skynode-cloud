import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomBytes } from 'crypto';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { AppAuthService } from '../app-auth/app-auth.service';
import { ensureProjectDataPlaneSchema } from '../projects/provisioning/project-schema.initializer';
import { MailService } from '../mail/mail.service';
import type { TenantCallerContext } from './guards/tenant-access.guard';
import type {
  CreateTenantDto,
  UpdateTenantDto,
  CreateTenantRoleDto,
  AddTenantMemberDto,
  UpdateTenantMemberDto,
  CreateTenantInvitationDto,
  UpdateMultiTenancySettingsDto,
} from './dto/tenants.dto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  plan: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly connManager: ProjectConnectionManager,
    private readonly appAuthService: AppAuthService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  private isServiceRole(caller: TenantCallerContext): boolean {
    return caller.mode === 'service_role';
  }

  private async withSchemaClient<T>(
    projectIdentifier: string,
    fn: (client: PoolClient, projectRef: string) => Promise<T>,
  ): Promise<T> {
    const resolved = await this.appAuthService.resolveProject(projectIdentifier);
    return this.connManager.withClient(resolved.creds, async (client) => {
      await ensureProjectDataPlaneSchema(client, {
        ref: resolved.ref,
        logger: this.logger,
      });
      return fn(client, resolved.ref);
    });
  }

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || `tenant-${randomBytes(4).toString('hex')}`
    );
  }

  private async resolveTenant(
    client: PoolClient,
    tenantIdOrSlug: string,
  ): Promise<TenantRecord> {
    const byUuid = UUID_REGEX.test(tenantIdOrSlug);
    const res = await client.query<TenantRecord>(
      byUuid
        ? `SELECT id, slug, name, status, plan, metadata, created_at, updated_at FROM auth.tenants WHERE id = $1 OR slug = $2 LIMIT 1`
        : `SELECT id, slug, name, status, plan, metadata, created_at, updated_at FROM auth.tenants WHERE slug = $1 LIMIT 1`,
      byUuid ? [tenantIdOrSlug, tenantIdOrSlug] : [tenantIdOrSlug],
    );
    if (!res.rows[0]) {
      throw new NotFoundException(`Tenant "${tenantIdOrSlug}" not found`);
    }
    return res.rows[0];
  }

  /**
   * Verifies caller authorization against a specific tenant.
   * Returns caller's active membership role (null when caller is service_role).
   */
  private async assertTenantAccess(
    client: PoolClient,
    caller: TenantCallerContext,
    tenant: TenantRecord,
    allowedRoles?: string[],
    requiredPermission?: { resource: string; action: string },
  ): Promise<{ roleId: string; roleName: string } | null> {
    if (this.isServiceRole(caller)) {
      return null;
    }

    if (!caller.userId) {
      throw new ForbiddenException('Authenticated user identity required');
    }

    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenException(`Tenant "${tenant.slug}" is ${tenant.status.toLowerCase()}`);
    }

    const memRes = await client.query<{
      status: string;
      role_id: string;
      role_name: string;
    }>(
      `SELECT tu.status, tr.id AS role_id, tr.name AS role_name
       FROM auth.tenant_users tu
       JOIN auth.tenant_roles tr ON tr.id = tu.role_id
       WHERE tu.tenant_id = $1 AND tu.user_id = $2`,
      [tenant.id, caller.userId],
    );

    const membership = memRes.rows[0];
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Access denied: not an active member of this tenant');
    }

    if (allowedRoles && allowedRoles.includes(membership.role_name.toLowerCase())) {
      return { roleId: membership.role_id, roleName: membership.role_name };
    }

    if (requiredPermission) {
      const permRes = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM auth.tenant_permissions
           WHERE role_id = $1
             AND (resource = $2 OR resource = '*')
             AND (action = $3 OR action = '*')
         ) AS exists`,
        [membership.role_id, requiredPermission.resource, requiredPermission.action],
      );
      if (permRes.rows[0]?.exists) {
        return { roleId: membership.role_id, roleName: membership.role_name };
      }
    }

    if (allowedRoles || requiredPermission) {
      throw new ForbiddenException('Insufficient permissions within this tenant');
    }

    return { roleId: membership.role_id, roleName: membership.role_name };
  }

  private async resolveRole(
    client: PoolClient,
    tenantId: string | null,
    roleId?: string,
    roleName?: string,
  ): Promise<{ id: string; name: string }> {
    if (roleId && UUID_REGEX.test(roleId)) {
      const res = await client.query<{ id: string; name: string; tenant_id: string | null }>(
        `SELECT id, name, tenant_id FROM auth.tenant_roles
         WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
        [roleId, tenantId],
      );
      if (!res.rows[0]) {
        throw new NotFoundException(`Role "${roleId}" not found for this tenant`);
      }
      return { id: res.rows[0].id, name: res.rows[0].name };
    }

    const name = (roleName || 'member').trim();
    const res = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM auth.tenant_roles
       WHERE LOWER(name) = LOWER($1) AND (tenant_id = $2 OR tenant_id IS NULL)
       ORDER BY CASE WHEN tenant_id IS NOT NULL THEN 0 ELSE 1 END
       LIMIT 1`,
      [name, tenantId],
    );
    if (!res.rows[0]) {
      throw new NotFoundException(`Role "${name}" not found`);
    }
    return res.rows[0];
  }

  // ── Multi-Tenancy Settings ───────────────────────────────────────────────

  async getSettings(projectIdentifier: string) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const res = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM auth.project_settings WHERE key = 'multi_tenancy'`,
      );
      return {
        allow_self_serve_tenants: true,
        require_tenant_for_api: false,
        ...(res.rows[0]?.value ?? {}),
      };
    });
  }

  async updateSettings(
    projectIdentifier: string,
    caller: TenantCallerContext,
    dto: UpdateMultiTenancySettingsDto,
  ) {
    if (!this.isServiceRole(caller)) {
      throw new ForbiddenException('Only service_role or project owner can change project settings');
    }

    return this.withSchemaClient(projectIdentifier, async (client) => {
      const current = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM auth.project_settings WHERE key = 'multi_tenancy'`,
      );
      const merged = {
        allow_self_serve_tenants: true,
        require_tenant_for_api: false,
        ...(current.rows[0]?.value ?? {}),
        ...(dto.allow_self_serve_tenants !== undefined
          ? { allow_self_serve_tenants: dto.allow_self_serve_tenants }
          : {}),
        ...(dto.require_tenant_for_api !== undefined
          ? { require_tenant_for_api: dto.require_tenant_for_api }
          : {}),
      };

      await client.query(
        `INSERT INTO auth.project_settings (key, value, updated_at)
         VALUES ('multi_tenancy', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(merged)],
      );
      return merged;
    });
  }

  // ── Tenant Lifecycle CRUD ────────────────────────────────────────────────

  async createTenant(
    projectIdentifier: string,
    caller: TenantCallerContext,
    dto: CreateTenantDto,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      // Check self-serve policy if caller is a regular end-user
      if (!this.isServiceRole(caller)) {
        const settingsRes = await client.query<{ value: { allow_self_serve_tenants?: boolean } }>(
          `SELECT value FROM auth.project_settings WHERE key = 'multi_tenancy'`,
        );
        const allowSelfServe = settingsRes.rows[0]?.value?.allow_self_serve_tenants ?? true;
        if (!allowSelfServe) {
          throw new ForbiddenException(
            'Tenant creation is restricted to backend administrators (service_role) for this project',
          );
        }
      }

      const baseSlug = dto.slug ? dto.slug.toLowerCase() : this.generateSlug(dto.name);
      const ownerUserId =
        this.isServiceRole(caller) && dto.owner_user_id ? dto.owner_user_id : caller.userId;

      await client.query('BEGIN');
      try {
        const dup = await client.query(`SELECT id FROM auth.tenants WHERE slug = $1`, [baseSlug]);
        if (dup.rowCount && dup.rowCount > 0) {
          throw new ConflictException(`Tenant slug "${baseSlug}" already exists`);
        }

        const tenantRes = await client.query<TenantRecord>(
          `INSERT INTO auth.tenants (name, slug, plan, metadata)
           VALUES ($1, $2, $3, $4::jsonb)
           RETURNING id, slug, name, status, plan, metadata, created_at, updated_at`,
          [
            dto.name.trim(),
            baseSlug,
            dto.plan ?? 'STANDARD',
            JSON.stringify(dto.metadata ?? {}),
          ],
        );
        const tenant = tenantRes.rows[0]!;

        let ownerMembership: Record<string, unknown> | null = null;
        if (ownerUserId) {
          const userCheck = await client.query(`SELECT id FROM auth.users WHERE id = $1`, [
            ownerUserId,
          ]);
          if (!userCheck.rowCount || userCheck.rowCount === 0) {
            throw new NotFoundException(`Owner user "${ownerUserId}" not found in auth.users`);
          }

          const ownerRole = await this.resolveRole(client, tenant.id, undefined, 'owner');
          const memRes = await client.query(
            `INSERT INTO auth.tenant_users (tenant_id, user_id, role_id, status)
             VALUES ($1, $2, $3, 'ACTIVE')
             RETURNING id, tenant_id, user_id, role_id, status, created_at`,
            [tenant.id, ownerUserId, ownerRole.id],
          );
          ownerMembership = memRes.rows[0] ?? null;
        }

        await client.query('COMMIT');
        return { ...tenant, owner_membership: ownerMembership };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }

  async listTenants(
    projectIdentifier: string,
    caller: TenantCallerContext,
    options: { page?: number; limit?: number; status?: string; search?: string } = {},
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const page = Math.max(options.page || 1, 1);
      const limit = Math.min(Math.max(options.limit || 25, 1), 100);
      const offset = (page - 1) * limit;

      if (this.isServiceRole(caller)) {
        const clauses: string[] = [];
        const params: unknown[] = [];

        if (options.status) {
          params.push(options.status.toUpperCase());
          clauses.push(`t.status = $${params.length}`);
        }
        if (options.search) {
          params.push(`%${options.search.trim()}%`);
          clauses.push(`(t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length})`);
        }

        const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
        const listParams = [...params, limit, offset];

        const [rowsRes, countRes] = await Promise.all([
          client.query(
            `SELECT t.*,
                    (SELECT COUNT(*)::int FROM auth.tenant_users tu WHERE tu.tenant_id = t.id AND tu.status = 'ACTIVE') AS member_count
             FROM auth.tenants t
             ${whereSql}
             ORDER BY t.created_at DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            listParams,
          ),
          client.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM auth.tenants t ${whereSql}`,
            params,
          ),
        ]);

        return {
          tenants: rowsRes.rows,
          total: countRes.rows[0]?.total ?? 0,
          page,
          limit,
        };
      }

      // End-users only see tenants where they have an ACTIVE membership
      const rowsRes = await client.query(
        `SELECT t.*,
                tr.name AS my_role,
                tu.custom_attributes AS my_attributes
         FROM auth.tenant_users tu
         JOIN auth.tenants t ON t.id = tu.tenant_id
         JOIN auth.tenant_roles tr ON tr.id = tu.role_id
         WHERE tu.user_id = $1 AND tu.status = 'ACTIVE' AND t.status = 'ACTIVE'
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [caller.userId, limit, offset],
      );

      return {
        tenants: rowsRes.rows,
        total: rowsRes.rows.length,
        page,
        limit,
      };
    });
  }

  async getTenant(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const roleCtx = await this.assertTenantAccess(client, caller, tenant);
      const countRes = await client.query<{ member_count: number }>(
        `SELECT COUNT(*)::int AS member_count FROM auth.tenant_users WHERE tenant_id = $1 AND status = 'ACTIVE'`,
        [tenant.id],
      );
      return {
        ...tenant,
        member_count: countRes.rows[0]?.member_count ?? 0,
        caller_role: roleCtx?.roleName ?? (this.isServiceRole(caller) ? 'service_role' : null),
      };
    });
  }

  async updateTenant(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    dto: UpdateTenantDto,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
        resource: 'tenants',
        action: 'update',
      });

      const sets: string[] = [];
      const values: unknown[] = [];

      if (dto.name !== undefined) {
        values.push(dto.name.trim());
        sets.push(`name = $${values.length}`);
      }
      if (dto.slug !== undefined) {
        const cleanSlug = dto.slug.toLowerCase();
        const dup = await client.query(
          `SELECT id FROM auth.tenants WHERE slug = $1 AND id != $2`,
          [cleanSlug, tenant.id],
        );
        if (dup.rowCount && dup.rowCount > 0) {
          throw new ConflictException(`Tenant slug "${cleanSlug}" already exists`);
        }
        values.push(cleanSlug);
        sets.push(`slug = $${values.length}`);
      }
      if (dto.plan !== undefined) {
        if (!this.isServiceRole(caller)) {
          throw new ForbiddenException('Only service_role / platform owner can change tenant plan');
        }
        values.push(dto.plan);
        sets.push(`plan = $${values.length}`);
      }
      if (dto.metadata !== undefined) {
        values.push(JSON.stringify(dto.metadata));
        sets.push(`metadata = $${values.length}::jsonb`);
      }

      if (sets.length === 0) throw new BadRequestException('No fields to update');

      sets.push(`updated_at = NOW()`);
      values.push(tenant.id);

      const res = await client.query<TenantRecord>(
        `UPDATE auth.tenants SET ${sets.join(', ')} WHERE id = $${values.length}
         RETURNING id, slug, name, status, plan, metadata, created_at, updated_at`,
        values,
      );
      return res.rows[0]!;
    });
  }

  async updateTenantStatus(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
  ) {
    if (!this.isServiceRole(caller)) {
      throw new ForbiddenException(
        'Only backend administrators (service_role) or project owner can suspend or activate tenants',
      );
    }

    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const res = await client.query<TenantRecord>(
        `UPDATE auth.tenants SET status = $1, updated_at = NOW() WHERE id = $2
         RETURNING id, slug, name, status, plan, metadata, created_at, updated_at`,
        [status, tenant.id],
      );
      return res.rows[0]!;
    });
  }

  async deleteTenant(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      await this.assertTenantAccess(client, caller, tenant, ['owner'], {
        resource: 'tenants',
        action: 'delete',
      });

      await client.query(`DELETE FROM auth.tenants WHERE id = $1`, [tenant.id]);
      return { deleted: true, tenant_id: tenant.id, slug: tenant.slug };
    });
  }

  // ── Universal Roles & Permissions ────────────────────────────────────────

  async listRoles(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug?: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      let tenantId: string | null = null;
      if (tenantIdOrSlug) {
        const tenant = await this.resolveTenant(client, tenantIdOrSlug);
        await this.assertTenantAccess(client, caller, tenant);
        tenantId = tenant.id;
      }

      const res = await client.query(
        `SELECT tr.*,
                COALESCE(
                  (SELECT json_agg(json_build_object('id', tp.id, 'resource', tp.resource, 'action', tp.action))
                   FROM auth.tenant_permissions tp WHERE tp.role_id = tr.id),
                  '[]'::json
                ) AS permissions
         FROM auth.tenant_roles tr
         WHERE tr.tenant_id IS NULL ${tenantId ? 'OR tr.tenant_id = $1' : ''}
         ORDER BY tr.is_system DESC, tr.name ASC`,
        tenantId ? [tenantId] : [],
      );
      return res.rows;
    });
  }

  async createRole(
    projectIdentifier: string,
    caller: TenantCallerContext,
    dto: CreateTenantRoleDto,
    tenantIdOrSlug?: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      let tenantId: string | null = null;
      if (tenantIdOrSlug) {
        const tenant = await this.resolveTenant(client, tenantIdOrSlug);
        await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
          resource: 'roles',
          action: 'create',
        });
        tenantId = tenant.id;
      } else if (!this.isServiceRole(caller)) {
        throw new ForbiddenException('Only service_role or project owner can define global project roles');
      }

      await client.query('BEGIN');
      try {
        const dup = await client.query(
          tenantId
            ? `SELECT id FROM auth.tenant_roles WHERE tenant_id = $1 AND LOWER(name) = LOWER($2)`
            : `SELECT id FROM auth.tenant_roles WHERE tenant_id IS NULL AND LOWER(name) = LOWER($1)`,
          tenantId ? [tenantId, dto.name] : [dto.name],
        );
        if (dup.rowCount && dup.rowCount > 0) {
          throw new ConflictException(`Role "${dto.name}" already exists`);
        }

        const roleRes = await client.query<{ id: string }>(
          `INSERT INTO auth.tenant_roles (tenant_id, name, description, is_system)
           VALUES ($1, $2, $3, FALSE)
           RETURNING *`,
          [tenantId, dto.name.trim(), dto.description ?? null],
        );
        const role = roleRes.rows[0]!;

        const perms = dto.permissions ?? [];
        for (const p of perms) {
          await client.query(
            `INSERT INTO auth.tenant_permissions (role_id, resource, action)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [role.id, p.resource.trim(), p.action.trim()],
          );
        }

        await client.query('COMMIT');
        return { ...role, permissions: perms };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }

  async deleteRole(
    projectIdentifier: string,
    caller: TenantCallerContext,
    roleId: string,
    tenantIdOrSlug?: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const roleRes = await client.query<{
        id: string;
        tenant_id: string | null;
        is_system: boolean;
      }>(`SELECT id, tenant_id, is_system FROM auth.tenant_roles WHERE id = $1`, [roleId]);

      const role = roleRes.rows[0];
      if (!role) throw new NotFoundException('Role not found');
      if (role.is_system) throw new BadRequestException('Cannot delete built-in system roles');

      if (role.tenant_id) {
        const tenant = await this.resolveTenant(client, tenantIdOrSlug || role.tenant_id);
        if (tenant.id !== role.tenant_id) {
          throw new ForbiddenException('Role does not belong to target tenant');
        }
        await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
          resource: 'roles',
          action: 'delete',
        });
      } else if (!this.isServiceRole(caller)) {
        throw new ForbiddenException('Only service_role or project owner can delete global roles');
      }

      const inUse = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM auth.tenant_users WHERE role_id = $1`,
        [role.id],
      );
      if ((inUse.rows[0]?.cnt ?? 0) > 0) {
        throw new ConflictException('Cannot delete role currently assigned to members');
      }

      await client.query(`DELETE FROM auth.tenant_roles WHERE id = $1`, [role.id]);
      return { deleted: true, role_id: role.id };
    });
  }

  // ── Tenant Memberships ───────────────────────────────────────────────────

  async listMembers(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      await this.assertTenantAccess(client, caller, tenant);

      const res = await client.query(
        `SELECT tu.id, tu.tenant_id, tu.user_id, tu.status, tu.custom_attributes,
                tu.created_at, tu.updated_at,
                u.email, u.full_name, u.avatar_url,
                tr.id AS role_id, tr.name AS role_name
         FROM auth.tenant_users tu
         JOIN auth.users u ON u.id = tu.user_id
         JOIN auth.tenant_roles tr ON tr.id = tu.role_id
         WHERE tu.tenant_id = $1
         ORDER BY tu.created_at ASC`,
        [tenant.id],
      );

      return { tenant_id: tenant.id, members: res.rows };
    });
  }

  async addMember(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    dto: AddTenantMemberDto,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const callerCtx = await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
        resource: 'members',
        action: 'create',
      });

      if (!dto.user_id && !dto.email) {
        throw new BadRequestException('Either user_id or email is required');
      }

      const userRes = dto.user_id
        ? await client.query<{ id: string; email: string; full_name: string | null }>(
            `SELECT id, email, full_name FROM auth.users WHERE id = $1`,
            [dto.user_id],
          )
        : await client.query<{ id: string; email: string; full_name: string | null }>(
            `SELECT id, email, full_name FROM auth.users WHERE LOWER(email) = $1`,
            [dto.email!.trim().toLowerCase()],
          );

      const targetUser = userRes.rows[0];
      if (!targetUser) {
        throw new NotFoundException('User account not found in auth.users');
      }

      const targetRole = await this.resolveRole(client, tenant.id, dto.role_id, dto.role);

      // Prevent privilege escalation: non-owners cannot assign 'owner' role
      if (
        !this.isServiceRole(caller) &&
        targetRole.name.toLowerCase() === 'owner' &&
        callerCtx?.roleName.toLowerCase() !== 'owner'
      ) {
        throw new ForbiddenException('Only a tenant owner or service_role can assign the owner role');
      }

      const dup = await client.query(
        `SELECT id FROM auth.tenant_users WHERE tenant_id = $1 AND user_id = $2`,
        [tenant.id, targetUser.id],
      );
      if (dup.rowCount && dup.rowCount > 0) {
        throw new ConflictException('User is already a member of this tenant');
      }

      const res = await client.query(
        `INSERT INTO auth.tenant_users (tenant_id, user_id, role_id, status, custom_attributes)
         VALUES ($1, $2, $3, 'ACTIVE', $4::jsonb)
         RETURNING *`,
        [tenant.id, targetUser.id, targetRole.id, JSON.stringify(dto.custom_attributes ?? {})],
      );

      return {
        ...res.rows[0],
        email: targetUser.email,
        full_name: targetUser.full_name,
        role_name: targetRole.name,
      };
    });
  }

  async updateMember(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    targetUserId: string,
    dto: UpdateTenantMemberDto,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const callerCtx = await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
        resource: 'members',
        action: 'update',
      });

      const existingRes = await client.query<{
        id: string;
        role_id: string;
        role_name: string;
      }>(
        `SELECT tu.id, tu.role_id, tr.name AS role_name
         FROM auth.tenant_users tu
         JOIN auth.tenant_roles tr ON tr.id = tu.role_id
         WHERE tu.tenant_id = $1 AND tu.user_id = $2`,
        [tenant.id, targetUserId],
      );
      const existing = existingRes.rows[0];
      if (!existing) throw new NotFoundException('Tenant membership not found');

      if (
        !this.isServiceRole(caller) &&
        existing.role_name.toLowerCase() === 'owner' &&
        callerCtx?.roleName.toLowerCase() !== 'owner'
      ) {
        throw new ForbiddenException('Non-owners cannot modify an owner membership');
      }

      const sets: string[] = [];
      const values: unknown[] = [];

      if (dto.role_id || dto.role) {
        const nextRole = await this.resolveRole(client, tenant.id, dto.role_id, dto.role);
        if (
          !this.isServiceRole(caller) &&
          nextRole.name.toLowerCase() === 'owner' &&
          callerCtx?.roleName.toLowerCase() !== 'owner'
        ) {
          throw new ForbiddenException('Only an owner or service_role can grant owner role');
        }
        values.push(nextRole.id);
        sets.push(`role_id = $${values.length}`);
      }

      if (dto.status !== undefined) {
        values.push(dto.status);
        sets.push(`status = $${values.length}`);
      }

      if (dto.custom_attributes !== undefined) {
        values.push(JSON.stringify(dto.custom_attributes));
        sets.push(`custom_attributes = $${values.length}::jsonb`);
      }

      if (sets.length === 0) throw new BadRequestException('No fields provided to update');

      sets.push(`updated_at = NOW()`);
      values.push(existing.id);

      const updated = await client.query(
        `UPDATE auth.tenant_users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values,
      );

      // Force token refresh / active tenant reset if suspended
      if (dto.status === 'SUSPENDED') {
        await client.query(
          `UPDATE auth.sessions SET active_tenant_id = NULL WHERE user_id = $1 AND active_tenant_id = $2`,
          [targetUserId, tenant.id],
        );
      }

      return updated.rows[0];
    });
  }

  async removeMember(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    targetUserId: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const isSelfLeave = !this.isServiceRole(caller) && caller.userId === targetUserId;

      if (!isSelfLeave) {
        const callerCtx = await this.assertTenantAccess(
          client,
          caller,
          tenant,
          ['owner', 'admin'],
          { resource: 'members', action: 'delete' },
        );
        const targetMem = await client.query<{ role_name: string }>(
          `SELECT tr.name AS role_name FROM auth.tenant_users tu
           JOIN auth.tenant_roles tr ON tr.id = tu.role_id
           WHERE tu.tenant_id = $1 AND tu.user_id = $2`,
          [tenant.id, targetUserId],
        );
        if (
          !this.isServiceRole(caller) &&
          targetMem.rows[0]?.role_name.toLowerCase() === 'owner' &&
          callerCtx?.roleName.toLowerCase() !== 'owner'
        ) {
          throw new ForbiddenException('Non-owners cannot remove a tenant owner');
        }
      } else {
        await this.assertTenantAccess(client, caller, tenant);
      }

      // Ensure last owner is not removed unless service_role explicitly does it
      if (!this.isServiceRole(caller)) {
        const ownersCount = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM auth.tenant_users tu
           JOIN auth.tenant_roles tr ON tr.id = tu.role_id
           WHERE tu.tenant_id = $1 AND LOWER(tr.name) = 'owner' AND tu.status = 'ACTIVE'`,
          [tenant.id],
        );
        const targetIsOwner = await client.query<{ is_owner: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM auth.tenant_users tu
             JOIN auth.tenant_roles tr ON tr.id = tu.role_id
             WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND LOWER(tr.name) = 'owner'
           ) AS is_owner`,
          [tenant.id, targetUserId],
        );
        if (targetIsOwner.rows[0]?.is_owner && (ownersCount.rows[0]?.cnt ?? 0) <= 1) {
          throw new BadRequestException('Cannot remove the last owner of a tenant');
        }
      }

      const delRes = await client.query(
        `DELETE FROM auth.tenant_users WHERE tenant_id = $1 AND user_id = $2 RETURNING id`,
        [tenant.id, targetUserId],
      );
      if (!delRes.rowCount || delRes.rowCount === 0) {
        throw new NotFoundException('Membership not found');
      }

      await client.query(
        `UPDATE auth.sessions SET active_tenant_id = NULL WHERE user_id = $1 AND active_tenant_id = $2`,
        [targetUserId, tenant.id],
      );

      return { removed: true, tenant_id: tenant.id, user_id: targetUserId };
    });
  }

  // ── Tenant Invitations ───────────────────────────────────────────────────

  async createInvitation(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
    dto: CreateTenantInvitationDto,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      const callerCtx = await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
        resource: 'invitations',
        action: 'create',
      });

      const role = await this.resolveRole(client, tenant.id, dto.role_id, dto.role);
      if (
        !this.isServiceRole(caller) &&
        role.name.toLowerCase() === 'owner' &&
        callerCtx?.roleName.toLowerCase() !== 'owner'
      ) {
        throw new ForbiddenException('Only an owner or service_role can invite as owner');
      }

      const normalizedEmail = dto.email.trim().toLowerCase();
      let inviterId = caller.userId;

      if (!inviterId) {
        // When invited via service_role/Studio, find an active owner or first auth user for FK attribution
        const fallbackUser = await client.query<{ id: string }>(
          `SELECT user_id AS id FROM auth.tenant_users WHERE tenant_id = $1 LIMIT 1`,
          [tenant.id],
        );
        if (fallbackUser.rows[0]) {
          inviterId = fallbackUser.rows[0].id;
        } else {
          const anyUser = await client.query<{ id: string }>(`SELECT id FROM auth.users LIMIT 1`);
          inviterId = anyUser.rows[0]?.id;
        }
      }

      if (!inviterId) {
        throw new BadRequestException(
          'At least one registered user must exist in auth.users before sending invitations',
        );
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      const res = await client.query(
        `INSERT INTO auth.tenant_invitations
           (tenant_id, email, role_id, invited_by, token, custom_attributes, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING id, tenant_id, email, role_id, token, custom_attributes, expires_at, created_at`,
        [
          tenant.id,
          normalizedEmail,
          role.id,
          inviterId,
          token,
          JSON.stringify(dto.custom_attributes ?? {}),
          expiresAt,
        ],
      );

      await this.mailService
        ?.send({
          to: normalizedEmail,
          subject: `Invitation to join ${tenant.name}`,
          html: `<p>You have been invited to join <strong>${tenant.name}</strong> as <strong>${role.name}</strong>.</p><p>Invitation Token: <code>${token}</code></p>`,
          text: `You have been invited to join ${tenant.name} as ${role.name}. Token: ${token}`,
        })
        .catch(() => {});

      return { ...res.rows[0], role_name: role.name };
    });
  }

  async listInvitations(
    projectIdentifier: string,
    caller: TenantCallerContext,
    tenantIdOrSlug: string,
  ) {
    return this.withSchemaClient(projectIdentifier, async (client) => {
      const tenant = await this.resolveTenant(client, tenantIdOrSlug);
      await this.assertTenantAccess(client, caller, tenant, ['owner', 'admin'], {
        resource: 'invitations',
        action: 'read',
      });

      const res = await client.query(
        `SELECT ti.id, ti.tenant_id, ti.email, ti.role_id, tr.name AS role_name,
                ti.custom_attributes, ti.expires_at, ti.accepted_at, ti.created_at
         FROM auth.tenant_invitations ti
         JOIN auth.tenant_roles tr ON tr.id = ti.role_id
         WHERE ti.tenant_id = $1
         ORDER BY ti.created_at DESC`,
        [tenant.id],
      );
      return { tenant_id: tenant.id, invitations: res.rows };
    });
  }

  async acceptInvitation(
    projectIdentifier: string,
    caller: TenantCallerContext,
    token: string,
  ) {
    if (!caller.userId) {
      throw new ForbiddenException('Authenticated application user required to accept invitation');
    }

    return this.withSchemaClient(projectIdentifier, async (client) => {
      await client.query('BEGIN');
      try {
        const invRes = await client.query<{
          id: string;
          tenant_id: string;
          email: string;
          role_id: string;
          custom_attributes: Record<string, unknown>;
          expires_at: Date;
          accepted_at: Date | null;
        }>(
          `SELECT id, tenant_id, email, role_id, custom_attributes, expires_at, accepted_at
           FROM auth.tenant_invitations
           WHERE token = $1`,
          [token],
        );

        const inv = invRes.rows[0];
        if (!inv) throw new NotFoundException('Invalid invitation token');
        if (inv.accepted_at) throw new ConflictException('Invitation has already been accepted');
        if (inv.expires_at < new Date()) {
          throw new BadRequestException('Invitation has expired');
        }

        const userRes = await client.query<{ id: string; email: string }>(
          `SELECT id, email FROM auth.users WHERE id = $1`,
          [caller.userId],
        );
        const user = userRes.rows[0];
        if (!user) throw new NotFoundException('User account not found');

        if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
          throw new ForbiddenException(
            'Invitation email does not match your authenticated email address',
          );
        }

        const memRes = await client.query(
          `INSERT INTO auth.tenant_users (tenant_id, user_id, role_id, status, custom_attributes)
           VALUES ($1, $2, $3, 'ACTIVE', $4::jsonb)
           ON CONFLICT (tenant_id, user_id) DO UPDATE
             SET role_id = EXCLUDED.role_id,
                 status = 'ACTIVE',
                 custom_attributes = EXCLUDED.custom_attributes,
                 updated_at = NOW()
           RETURNING *`,
          [inv.tenant_id, user.id, inv.role_id, JSON.stringify(inv.custom_attributes ?? {})],
        );

        await client.query(
          `UPDATE auth.tenant_invitations SET accepted_at = NOW() WHERE id = $1`,
          [inv.id],
        );

        await client.query('COMMIT');
        return { accepted: true, membership: memRes.rows[0] };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  }
}
