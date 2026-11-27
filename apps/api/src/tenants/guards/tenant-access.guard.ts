import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service';
import { ProjectsService } from '../../projects/projects.service';
import { AppAuthService } from '../../app-auth/app-auth.service';

export interface TenantCallerContext {
  mode: 'service_role' | 'authenticated';
  projectId: string;
  projectRef: string;
  platformUserId?: string;
  userId?: string;
  email?: string;
  jwtTenantId?: string | null;
}

const COOKIE_NAME = 'skynode_session';

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly appAuthService: AppAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { tenantCaller?: TenantCallerContext }>();

    const rawId = req.params['identifier'] ?? req.params['ref'];
    const identifier = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!identifier) {
      throw new UnauthorizedException('Project identifier is required');
    }

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    const apiKeyHeader = req.headers['apikey'];
    const rawApiKey =
      (Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader) ??
      (bearer?.startsWith('sky_') ? bearer : undefined);

    // 1. If a user JWT is presented in Authorization header (and isn't a sky_ API key),
    //    always authenticate as that specific end-user (never accidentally elevate to service_role).
    if (bearer && !bearer.startsWith('sky_')) {
      let keyRole: 'anon' | 'service_role' | null = null;
      if (rawApiKey) {
        const validated = await this.projectsService.validateApiKey(identifier, rawApiKey);
        if (!validated) {
          throw new UnauthorizedException('Invalid or revoked API key');
        }
        keyRole = validated.role;
      }

      const { payload, projectRef } = await this.appAuthService.resolveAndVerifyToken(
        bearer,
        identifier,
      );
      if (!payload.sub) {
        throw new UnauthorizedException('Invalid JWT subject');
      }

      const resolved = await this.appAuthService.resolveProject(projectRef);
      req.tenantCaller = {
        mode: 'authenticated',
        projectId: resolved.id,
        projectRef: resolved.ref,
        userId: payload.sub,
        email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
        jwtTenantId: typeof payload['tenant_id'] === 'string' ? payload['tenant_id'] : null,
      };
      void keyRole;
      return true;
    }

    // 2. Check API Key (requires service_role key when no user JWT is provided)
    if (rawApiKey) {
      const validated = await this.projectsService.validateApiKey(identifier, rawApiKey);
      if (!validated) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      if (validated.role !== 'service_role') {
        throw new UnauthorizedException(
          'User authentication (Authorization: Bearer <jwt>) or service_role key required for tenant management',
        );
      }

      req.tenantCaller = {
        mode: 'service_role',
        projectId: validated.projectId,
        projectRef: validated.ref,
      };
      return true;
    }

    // 3. Check Developer Control-Plane Session Cookie (SkyNode Studio)
    const sessionToken = req.cookies?.[COOKIE_NAME];
    if (sessionToken) {
      const session = await this.authService.validateSession(sessionToken);
      if (!session) {
        throw new UnauthorizedException('Platform session expired');
      }
      // Verify the logged-in developer owns the project
      const project = await this.projectsService.findOne(identifier, session.userId);
      if (!project) {
        throw new ForbiddenException('You do not own this project');
      }

      req.tenantCaller = {
        mode: 'service_role',
        projectId: project.id,
        projectRef: project.ref,
        platformUserId: session.userId,
      };
      return true;
    }

    throw new UnauthorizedException(
      'Missing credentials. Provide Authorization: Bearer <token>, service_role apikey, or platform session.',
    );
  }
}
