import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AppAuthRequestContext } from '../guards/project-app-auth.guard';

export const AppCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { appUserId?: string }>();
    return req.appUserId!;
  },
);

export const AppAuthContext = createParamDecorator(
  (field: keyof AppAuthRequestContext | undefined, ctx: ExecutionContext) => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { appAuth?: AppAuthRequestContext }>();
    if (!req.appAuth) return undefined;
    return field ? req.appAuth[field] : req.appAuth;
  },
);
