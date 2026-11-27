import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { ProjectsService } from '../../projects/projects.service';
import { AppAuthService } from '../../app-auth/app-auth.service';
import {
  ProjectConnectionManager,
  ProjectDbCredentials,
  TenantExecutionContext,
} from '../../database-studio/project-connection.manager';
import { ensureProjectDataPlaneSchema } from '../../projects/provisioning/project-schema.initializer';

export interface ResolvedApiContext extends TenantExecutionContext {
  projectId: string;
  projectRef: string;
  creds: ProjectDbCredentials;
  tenantSlug?: string | null;
  permissions?: string[];
}

const COOKIE_NAME = 'skynode_session';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantApiGuard implements CanActivate {
  private readonly logger = new Logger(TenantApiGuard.name);
  private readonly schemaVerifiedRefs = new Set<string>();

  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly appAuthService: AppAuthService,
    private readonly connManager: ProjectConnectionManager,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { apiContext?: ResolvedApiContext }>();

    const rawId = req.params['identifier'] ?? req.params['ref'];
    const identifier = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!identifier) {
      throw new UnauthorizedException('Project identifier is required');
    }

    const project = await this.appAuthService.resolveProject(identifier);

    const apiKeyHeader = req.headers['apikey'] ?? req.query['apikey'];
    const rawApiKey = Array.isArray(apiKeyHeader)
      ? String(apiKeyHeader[0])
      : typeof apiKeyHeader === 'string'
        ? apiKeyHeader
        : undefined;

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    const tenantHeader = req.headers['x-tenant-id'];
    const requestedTenant = Array.isArray(tenantHeader)
      ? tenantHeader[0]
      : typeof tenantHeader === 'string'
        ? tenantHeader.trim()
        : undefined;

    // If an API key is supplied alongside Authorization (or as Bearer sky_...), validate it first
    const keyToValidate = rawApiKey ?? (bearer?.startsWith('sky_') ? bearer : undefined);
    let keyRole: 'anon' | 'service_role' | null = null;
    if (keyToValidate) {
      const keyResult = await this.projectsService.validateApiKey(project.ref, keyToValidate);
      if (!keyResult) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      keyRole = keyResult.role;
    }

    // 1. Authenticated End-User JWT flow (takes precedence over service_role key when JWT is presented)
    if (bearer && !bearer.startsWith('sky_')) {
      const payload = this.appAuthService.verifyToken(bearer, project.ref);
      const userId = payload.sub;
      if (!userId) {
        throw new UnauthorizedException('Invalid JWT subject');
      }
      const sessionId = typeof payload['sid'] === 'string' ? payload['sid'] : undefined;
      const jwtTenantId = typeof payload['tenant_id'] === 'string' ? payload['tenant_id'] : null;
      const effectiveTargetTenant = requestedTenant || jwtTenantId || null;

      const resolvedUser = await this.connManager.withClient(project.creds, async (client) => {
        if (!this.schemaVerifiedRefs.has(project.ref)) {
          await ensureProjectDataPlaneSchema(client, { ref: project.ref, logger: this.logger });
          this.schemaVerifiedRefs.add(project.ref);
        }

        // Verify user account is active and not banned
        const userRes = await client.query<{ is_banned: boolean }>(
          `SELECT is_banned FROM auth.users WHERE id = $1`,
          [userId],
        );
        const user = userRes.rows[0];
        if (!user || user.is_banned) {
          throw new UnauthorizedException('User account is invalid or suspended');
        }

        // Verify session has not been logged out or revoked
        if (sessionId) {
          const sessRes = await client.query<{ refresh_token_expires_at: Date }>(
            `SELECT refresh_token_expires_at FROM auth.sessions WHERE id = $1 AND user_id = $2`,
            [sessionId, userId],
          );
          if (!sessRes.rows[0] || sessRes.rows[0].refresh_token_expires_at < new Date()) {
            throw new UnauthorizedException('Session expired or logged out');
          }
        }

        // Validate project-wide require_tenant_for_api setting
        if (!effectiveTargetTenant) {
          const settingsRes = await client.query<{ value: { require_tenant_for_api?: boolean } }>(
            `SELECT value FROM auth.project_settings WHERE key = 'multi_tenancy'`,
          );
          if (settingsRes.rows[0]?.value?.require_tenant_for_api) {
            throw new ForbiddenException('Active tenant context (X-Tenant-ID) is required');
          }
          return {
            tenantId: null as string | null,
            tenantSlug: null as string | null,
            tenantRole: 'authenticated',
            permissions: [] as string[],
          };
        }

        // Server-side validation of tenant membership & status (prevents X-Tenant-ID spoofing)
        const isUuid = UUID_REGEX.test(effectiveTargetTenant);
        const memRes = await client.query<{
          tenant_id: string;
          tenant_slug: string;
          tenant_status: string;
          membership_status: string;
          role_id: string;
          role_name: string;
          permissions: string[] | null;
        }>(
          `
          SELECT
            t.id AS tenant_id,
            t.slug AS tenant_slug,
            t.status AS tenant_status,
            tu.status AS membership_status,
            tr.id AS role_id,
            tr.name AS role_name,
            COALESCE(
              (SELECT array_agg(tp.resource || ':' || tp.action)
               FROM auth.tenant_permissions tp WHERE tp.role_id = tr.id),
              ARRAY[]::TEXT[]
            ) AS permissions
          FROM auth.tenant_users tu
          JOIN auth.tenants t ON t.id = tu.tenant_id
          JOIN auth.tenant_roles tr ON tr.id = tu.role_id
          WHERE tu.user_id = $1
            AND ${isUuid ? '(t.id = $2 OR t.slug = $3)' : 't.slug = $2'}
          LIMIT 1
          `,
          isUuid ? [userId, effectiveTargetTenant, effectiveTargetTenant] : [userId, effectiveTargetTenant],
        );

        const membership = memRes.rows[0];
        if (!membership) {
          throw new ForbiddenException(
            'Access denied: you are not a member of the requested tenant',
          );
        }
        if (membership.membership_status !== 'ACTIVE') {
          throw new ForbiddenException('Your membership in this tenant is suspended or inactive');
        }
        if (membership.tenant_status !== 'ACTIVE') {
          throw new ForbiddenException(
            `Tenant "${membership.tenant_slug}" is ${membership.tenant_status.toLowerCase()}`,
          );
        }

        return {
          tenantId: membership.tenant_id,
          tenantSlug: membership.tenant_slug,
          tenantRole: membership.role_name,
          permissions: Array.isArray(membership.permissions) ? membership.permissions : [],
        };
      });

      req.apiContext = {
        projectId: project.id,
        projectRef: project.ref,
        creds: project.creds,
        apiRole: 'authenticated',
        userId,
        tenantId: resolvedUser.tenantId,
        tenantSlug: resolvedUser.tenantSlug,
        tenantRole: resolvedUser.tenantRole,
        permissions: resolvedUser.permissions,
        claims: {
          sub: userId,
          email: payload['email'] ?? null,
          tenant_id: resolvedUser.tenantId,
          tenant_slug: resolvedUser.tenantSlug,
          role: resolvedUser.tenantRole,
          permissions: resolvedUser.permissions,
        },
      };
      return true;
    }

    // 2. Service Role API key (server-side only; bypasses RLS)
    if (keyRole === 'service_role') {
      req.apiContext = {
        projectId: project.id,
        projectRef: project.ref,
        creds: project.creds,
        apiRole: 'service_role',
        userId: null,
        tenantId: requestedTenant && UUID_REGEX.test(requestedTenant) ? requestedTenant : null,
        tenantRole: 'service_role',
      };
      return true;
    }

    // 3. Anonymous / Publishable API key (strictly enforces anon RLS; NEVER honors X-Tenant-ID)
    if (keyRole === 'anon') {
      req.apiContext = {
        projectId: project.id,
        projectRef: project.ref,
        creds: project.creds,
        apiRole: 'anon',
        userId: null,
        tenantId: null,
        tenantRole: 'anon',
      };
      return true;
    }

    // 4. Developer Control-Plane Session Cookie (for SkyNode Studio API Explorer)
    const sessionToken = req.cookies?.[COOKIE_NAME];
    if (sessionToken) {
      const session = await this.authService.validateSession(sessionToken);
      if (session) {
        await this.projectsService.findOne(project.ref, session.userId);
        req.apiContext = {
          projectId: project.id,
          projectRef: project.ref,
          creds: project.creds,
          apiRole: 'service_role',
          userId: null,
          tenantId: requestedTenant && UUID_REGEX.test(requestedTenant) ? requestedTenant : null,
          tenantRole: 'service_role',
        };
        return true;
      }
    }

    throw new UnauthorizedException(
      'Missing or invalid credentials. Supply a valid apikey header or Authorization Bearer token.',
    );
  }
}
