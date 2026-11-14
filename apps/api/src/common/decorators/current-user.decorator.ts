import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Custom parameter decorator that extracts the current user from the session.
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
    const session = request.session as Record<string, any>;

    const user = {
      userId: session?.userId,
      email: session?.email,
      role: session?.role,
      name: session?.name,
    };

    return field ? user[field as keyof typeof user] : user;
  },
);

/** Type-safe shape returned by @CurrentUser() when no field is specified. */
export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  name: string;
}
