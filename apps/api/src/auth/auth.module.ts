import { Module } from '@nestjs/common';

/**
 * AuthModule — handles user authentication and session management.
 *
 * Placeholder for Phase 3 implementation. Will include:
 * - Local email/password registration & login
 * - Session creation with express-session + connect-redis
 * - CSRF protection via csurf
 * - Password hashing with argon2
 * - MFA (TOTP) support
 * - Password reset flow
 */
@Module({
  controllers: [],
  providers: [],
  exports: [],
})
export class AuthModule {}
