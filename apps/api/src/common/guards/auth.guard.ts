import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Session-based authentication guard.
 * Checks that the incoming request has a valid session with an attached user.
 *
 * Apply to controllers / routes that require an authenticated user:
 *   @UseGuards(AuthGuard)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const session = request.session as Record<string, any>;

    if (!session?.userId) {
      this.logger.warn(
        `Unauthenticated request to ${request.method} ${request.url} from ${request.ip}`,
      );
      throw new UnauthorizedException('Authentication required. Please log in.');
    }

    // Check session expiry
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      this.logger.warn(`Expired session for userId=${session.userId}`);
      request.session.destroy(() => {});
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    return true;
  }
}
