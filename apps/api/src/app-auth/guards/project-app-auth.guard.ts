import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppAuthService } from '../app-auth.service';

@Injectable()
export class ProjectAppAuthGuard implements CanActivate {
  constructor(private readonly appAuthService: AppAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { appUserId?: string }>();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7);
    const ref = req.params['ref'];

    if (!ref) throw new UnauthorizedException('Missing project ref');

    const payload = this.appAuthService.verifyToken(token, Array.isArray(ref) ? ref[0]! : ref);
    if (!payload.sub) throw new UnauthorizedException('Invalid token payload');

    req.appUserId = payload.sub;
    return true;
  }
}
