import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Extracts the authenticated user from the request.
 * Set by AuthGuard after validating the session cookie.
 *
 * Usage:
 *   @Get('profile')
 *   getProfile(@CurrentUser() user: SessionUser) { ... }
 *
 *   @Get('id')
 *   getId(@CurrentUser('userId') userId: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    if (!user) return null;
    return field ? user[field as keyof typeof user] : user;
  },
);

/** Type-safe shape returned by @CurrentUser(). */
export interface SessionUser {
  userId: string;
  email: string;
  role: string;
}
