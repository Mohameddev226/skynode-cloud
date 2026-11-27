import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppAuthService } from '../app-auth.service';

export interface AppAuthRequestContext {
  userId: string;
  sessionId?: string;
  email?: string;
  projectRef: string;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantRole: string | null;
  permissions: string[];
}

@Injectable()
export class ProjectAppAuthGuard implements CanActivate {
  constructor(private readonly appAuthService: AppAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { appUserId?: string; appAuth?: AppAuthRequestContext }>();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7);
    const rawRef = req.params['ref'] ?? req.params['identifier'];
    const identifier = Array.isArray(rawRef) ? rawRef[0] : rawRef;

    if (!identifier) throw new UnauthorizedException('Missing project identifier');

    const { payload, projectRef } = await this.appAuthService.resolveAndVerifyToken(
      token,
      identifier,
    );
    if (!payload.sub) throw new UnauthorizedException('Invalid token payload');

    req.appUserId = payload.sub;
    req.appAuth = {
      userId: payload.sub,
      sessionId: typeof payload['sid'] === 'string' ? payload['sid'] : undefined,
      email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
      projectRef,
      tenantId: typeof payload['tenant_id'] === 'string' ? payload['tenant_id'] : null,
      tenantSlug: typeof payload['tenant_slug'] === 'string' ? payload['tenant_slug'] : null,
      tenantRole: typeof payload['tenant_role'] === 'string' ? payload['tenant_role'] : null,
      permissions: Array.isArray(payload['permissions'])
        ? (payload['permissions'] as string[])
        : [],
    };

    return true;
  }
}
