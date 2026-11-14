import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../../auth/auth.service';

const COOKIE_NAME = 'skynode_session';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.cookies?.[COOKIE_NAME];

    if (!token) {
      throw new UnauthorizedException('Authentication required. Please log in.');
    }

    const session = await this.authService.validateSession(token);

    if (!session) {
      this.logger.warn(
        `Invalid/expired session for ${request.method} ${request.url} from ${request.ip}`,
      );
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    // Attach user data to request for @CurrentUser() decorator
    (request as any).user = session;

    return true;
  }
}
