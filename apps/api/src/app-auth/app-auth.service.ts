import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
  HttpException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { ProjectConnectionManager, ProjectDbCredentials } from '../database-studio/project-connection.manager';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/utils/crypto.util';
import { ensureProjectDataPlaneSchema } from '../projects/provisioning/project-schema.initializer';
import { MailService } from '../mail/mail.service';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  email_confirmed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_sign_in_at: Date | null;
  is_banned: boolean;
}

export interface TenantMembershipSummary {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_status: string;
  role_id: string;
  role_name: string;
  membership_status: string;
  custom_attributes: Record<string, unknown>;
  permissions: string[];
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: Omit<AppUser, 'is_banned'>;
  active_tenant: TenantMembershipSummary | null;
  tenants: TenantMembershipSummary[];
}

@Injectable()
export class AppAuthService {
  private readonly logger = new Logger(AppAuthService.name);
  private readonly ACCESS_TOKEN_TTL = 3600; // 1 hour
  private readonly REFRESH_TOKEN_TTL = 60 * 60 * 24 * 7; // 7 days

  constructor(
    private readonly config: ConfigService,
    private readonly connManager: ProjectConnectionManager,
    private readonly prisma: PrismaService,
    @Optional() private readonly mailService?: MailService,
  ) {}

  private getJwtSecret(projectRef: string): string {
    const base = this.config.get<string>('JWT_SECRET') ?? 'skynode-jwt-secret-change-in-prod';
    return `${base}:${projectRef}`;
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async resolveProject(
    identifier: string,
  ): Promise<{ id: string; ref: string; slug: string; creds: ProjectDbCredentials }> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const or: Array<{ id?: string; slug?: string; ref?: string }> = [
      { ref: identifier },
      { slug: identifier },
    ];
    if (isUuid) or.push({ id: identifier });

    const project = await this.prisma.project.findFirst({
      where: {
        status: { not: 'DELETED' },
        OR: or,
      },
    });
    if (!project) throw new NotFoundException(`Project ${identifier} not found`);

    let passwordPlain = '';
    let forceFallback = false;
    try {
      passwordPlain = decrypt(project.dbPasswordEnc);
    } catch (decErr: any) {
      if (this.connManager.hasFallbackPool?.()) {
        this.logger.warn(
          `Could not decrypt dbPasswordEnc for project ${project.ref} (${decErr?.message}); falling back to shared DB pool.`,
        );
        forceFallback = true;
      } else {
        throw new InternalServerErrorException(
          'Unable to decrypt project database credentials. Check ENCRYPTION_KEY configuration.',
        );
      }
    }

    return {
      id: project.id,
      ref: project.ref,
      slug: project.slug,
      creds: {
        host: project.dbHost,
        port: project.dbPort,
        database: project.dbName,
        user: project.dbUser,
        password: passwordPlain,
        forceFallback,
      },
    };
  }

  private async withProjectClient<T>(
    projectIdentifier: string,
    fn: (client: PoolClient, resolvedRef: string) => Promise<T>,
  ): Promise<T> {
    const resolved = await this.resolveProject(projectIdentifier);
    try {
      return await this.connManager.withClient(resolved.creds, (client) => fn(client, resolved.ref));
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `AppAuth database operation failed for project ${resolved.ref}: [${err?.code || 'ERR'}] ${err?.message}`,
        err?.stack,
      );
      throw new InternalServerErrorException(
        err?.message ? `Authentication database error: ${err.message}` : 'Authentication database error',
      );
    }
  }

  private signAccessToken(payload: Record<string, unknown>, projectRef: string): string {
    return jwt.sign(payload, this.getJwtSecret(projectRef), {
      expiresIn: this.ACCESS_TOKEN_TTL,
      issuer: `skynode:${projectRef}`,
      algorithm: 'HS256',
    });
  }

  private signRefreshToken(userId: string, sessionId: string, projectRef: string): string {
    return jwt.sign(
      { sub: userId, sid: sessionId, type: 'refresh' },
      this.getJwtSecret(projectRef),
      { expiresIn: this.REFRESH_TOKEN_TTL, issuer: `skynode:${projectRef}`, algorithm: 'HS256' },
    );
  }

  verifyToken(token: string, projectRef: string): jwt.JwtPayload {
    try {
      const payload = jwt.verify(token, this.getJwtSecret(projectRef), {
        issuer: `skynode:${projectRef}`,
        algorithms: ['HS256'],
      });
      return payload as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  async resolveAndVerifyToken(
    token: string,
    projectIdentifier: string,
  ): Promise<{ payload: jwt.JwtPayload; projectRef: string }> {
    const resolved = await this.resolveProject(projectIdentifier);
    const payload = this.verifyToken(token, resolved.ref);
    return { payload, projectRef: resolved.ref };
  }

  private async ensureSchema(client: PoolClient, projectRef?: string): Promise<void> {
    await ensureProjectDataPlaneSchema(client, {
      ref: projectRef,
      logger: this.logger,
    });
  }

  /**
   * Loads active tenant memberships and effective permissions for a user.
   */
  async fetchUserMemberships(
    client: PoolClient,
    userId: string,
  ): Promise<TenantMembershipSummary[]> {
    const res = await client.query<{
      tenant_id: string;
      tenant_slug: string;
      tenant_name: string;
      tenant_status: string;
      role_id: string;
      role_name: string;
      membership_status: string;
      custom_attributes: Record<string, unknown> | null;
      permissions: string[] | null;
    }>(
      `
      SELECT
        t.id AS tenant_id,
        t.slug AS tenant_slug,
        t.name AS tenant_name,
        t.status AS tenant_status,
        tr.id AS role_id,
        tr.name AS role_name,
        tu.status AS membership_status,
        tu.custom_attributes,
        COALESCE(
          (
            SELECT array_agg(tp.resource || ':' || tp.action)
            FROM auth.tenant_permissions tp
            WHERE tp.role_id = tr.id
          ),
          ARRAY[]::TEXT[]
        ) AS permissions
      FROM auth.tenant_users tu
      JOIN auth.tenants t ON t.id = tu.tenant_id
      JOIN auth.tenant_roles tr ON tr.id = tu.role_id
      WHERE tu.user_id = $1
        AND tu.status = 'ACTIVE'
        AND t.status = 'ACTIVE'
      ORDER BY tu.created_at ASC
      `,
      [userId],
    ).catch(() => ({ rows: [] as any[] }));

    return res.rows.map((r) => ({
      tenant_id: r.tenant_id,
      tenant_slug: r.tenant_slug,
      tenant_name: r.tenant_name,
      tenant_status: r.tenant_status,
      role_id: r.role_id,
      role_name: r.role_name,
      membership_status: r.membership_status,
      custom_attributes: r.custom_attributes ?? {},
      permissions: Array.isArray(r.permissions) ? r.permissions : [],
    }));
  }

  private buildTokenPair(
    user: AppUser,
    sessionId: string,
    projectRef: string,
    memberships: TenantMembershipSummary[] = [],
    activeTenant: TenantMembershipSummary | null = null,
  ): TokenPair {
    const payload = {
      sub: user.id,
      email: user.email,
      full_name: user.full_name,
      role: 'authenticated',
      api_role: 'authenticated',
      sid: sessionId,
      tenant_id: activeTenant?.tenant_id ?? null,
      tenant_slug: activeTenant?.tenant_slug ?? null,
      tenant_role: activeTenant?.role_name ?? null,
      permissions: activeTenant?.permissions ?? [],
    };

    return {
      access_token: this.signAccessToken(payload, projectRef),
      refresh_token: this.signRefreshToken(user.id, sessionId, projectRef),
      token_type: 'bearer',
      expires_in: this.ACCESS_TOKEN_TTL,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        email_confirmed_at: user.email_confirmed_at,
        created_at: user.created_at,
        updated_at: user.updated_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      active_tenant: activeTenant,
      tenants: memberships,
    };
  }

  async register(
    projectIdentifier: string,
    email: string,
    password: string,
    fullName?: string,
  ): Promise<TokenPair> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);

      const normalizedEmail = email.trim().toLowerCase();
      const existing = await client.query('SELECT id FROM auth.users WHERE LOWER(email) = $1', [
        normalizedEmail,
      ]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException('Email already registered');
      }

      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });

      const confirmRaw = randomBytes(32).toString('base64url');
      const confirmHash = this.hashToken(confirmRaw);

      const result = await client.query<AppUser>(
        `INSERT INTO auth.users (
           email, encrypted_password, full_name, email_confirmed_at,
           confirmation_token, confirmation_sent_at
         )
         VALUES ($1, $2, $3, NOW(), $4, NOW())
         RETURNING id, email, full_name, email_confirmed_at, created_at, updated_at, last_sign_in_at, is_banned`,
        [normalizedEmail, hash, fullName ?? null, confirmHash],
      );

      const user = result.rows[0]!;
      const sessionId = randomUUID();
      const refreshToken = randomBytes(48).toString('base64url');
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      await client.query(
        `INSERT INTO auth.sessions (id, user_id, refresh_token, refresh_token_expires_at)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, user.id, refreshToken, expiresAt],
      );

      const tokens = this.buildTokenPair(user, sessionId, projectRef, [], null);
      tokens.refresh_token = refreshToken;
      return tokens;
    });
  }

  async login(
    projectIdentifier: string,
    email: string,
    password: string,
    requestedTenantIdentifier?: string,
  ): Promise<TokenPair> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);

      const normalizedEmail = email.trim().toLowerCase();
      const result = await client.query<AppUser & { encrypted_password: string }>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned, encrypted_password
         FROM auth.users WHERE LOWER(email) = $1`,
        [normalizedEmail],
      );

      const user = result.rows[0];
      if (!user) throw new UnauthorizedException('Invalid email or password');
      if (user.is_banned) throw new UnauthorizedException('Account suspended');

      const valid = await argon2.verify(user.encrypted_password, password);
      if (!valid) throw new UnauthorizedException('Invalid email or password');

      // Load active tenant memberships
      const memberships = await this.fetchUserMemberships(client, user.id);

      let activeTenant: TenantMembershipSummary | null = null;
      if (requestedTenantIdentifier) {
        activeTenant =
          memberships.find(
            (m) =>
              m.tenant_id === requestedTenantIdentifier ||
              m.tenant_slug === requestedTenantIdentifier,
          ) ?? null;
        if (!activeTenant) {
          throw new ForbiddenException('User is not an active member of the requested tenant');
        }
      } else if (memberships.length > 0) {
        activeTenant = memberships[0]!;
      }

      // Update last_sign_in_at
      await client.query(
        'UPDATE auth.users SET last_sign_in_at = NOW(), updated_at = NOW() WHERE id = $1',
        [user.id],
      );

      const sessionId = randomUUID();
      const refreshToken = randomBytes(48).toString('base64url');
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      await client.query(
        `INSERT INTO auth.sessions (id, user_id, active_tenant_id, refresh_token, refresh_token_expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, user.id, activeTenant?.tenant_id ?? null, refreshToken, expiresAt],
      );

      const tokens = this.buildTokenPair(user, sessionId, projectRef, memberships, activeTenant);
      tokens.refresh_token = refreshToken;
      return tokens;
    });
  }

  async refreshToken(projectIdentifier: string, refreshToken: string): Promise<TokenPair> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      const sessionResult = await client.query<{
        id: string;
        user_id: string;
        active_tenant_id: string | null;
        refresh_token_expires_at: Date;
      }>(
        `SELECT id, user_id, active_tenant_id, refresh_token_expires_at FROM auth.sessions
         WHERE refresh_token = $1`,
        [refreshToken],
      );

      const session = sessionResult.rows[0];
      if (!session) throw new UnauthorizedException('Invalid refresh token');
      if (session.refresh_token_expires_at < new Date()) {
        await client.query('DELETE FROM auth.sessions WHERE id = $1', [session.id]);
        throw new UnauthorizedException('Refresh token expired');
      }

      const userResult = await client.query<AppUser>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned
         FROM auth.users WHERE id = $1`,
        [session.user_id],
      );

      const user = userResult.rows[0];
      if (!user || user.is_banned) throw new UnauthorizedException('Account not accessible');

      const memberships = await this.fetchUserMemberships(client, user.id);
      let activeTenant: TenantMembershipSummary | null = null;
      if (session.active_tenant_id) {
        activeTenant =
          memberships.find((m) => m.tenant_id === session.active_tenant_id) ?? null;
      }
      if (!activeTenant && memberships.length > 0) {
        activeTenant = memberships[0]!;
      }

      // Rotate refresh token
      const newRefreshToken = randomBytes(48).toString('base64url');
      const newExpiry = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      await client.query(
        `UPDATE auth.sessions
         SET refresh_token = $1, refresh_token_expires_at = $2, active_tenant_id = $3, updated_at = NOW()
         WHERE id = $4`,
        [newRefreshToken, newExpiry, activeTenant?.tenant_id ?? null, session.id],
      );

      const tokens = this.buildTokenPair(user, session.id, projectRef, memberships, activeTenant);
      tokens.refresh_token = newRefreshToken;
      return tokens;
    });
  }

  /**
   * Switches the authenticated user's active tenant context after server-side membership validation.
   */
  async switchTenant(
    projectIdentifier: string,
    userId: string,
    sessionId: string | undefined,
    targetTenantIdentifier: string,
  ): Promise<TokenPair> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);

      const userResult = await client.query<AppUser>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned
         FROM auth.users WHERE id = $1`,
        [userId],
      );
      const user = userResult.rows[0];
      if (!user || user.is_banned) {
        throw new UnauthorizedException('Account not accessible');
      }

      const memberships = await this.fetchUserMemberships(client, userId);
      const targetMembership = memberships.find(
        (m) => m.tenant_id === targetTenantIdentifier || m.tenant_slug === targetTenantIdentifier,
      );

      if (!targetMembership) {
        throw new ForbiddenException(
          'Access denied: you are not an active member of this tenant',
        );
      }

      let effectiveSessionId = sessionId;
      let refreshToken = randomBytes(48).toString('base64url');
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      if (effectiveSessionId) {
        const updatedSession = await client.query<{ refresh_token: string }>(
          `UPDATE auth.sessions
           SET active_tenant_id = $1, refresh_token = $2, refresh_token_expires_at = $3, updated_at = NOW()
           WHERE id = $4 AND user_id = $5
           RETURNING refresh_token`,
          [targetMembership.tenant_id, refreshToken, expiresAt, effectiveSessionId, userId],
        );
        if (!updatedSession.rowCount || updatedSession.rowCount === 0) {
          effectiveSessionId = undefined;
        }
      }

      if (!effectiveSessionId) {
        effectiveSessionId = randomUUID();
        await client.query(
          `INSERT INTO auth.sessions (id, user_id, active_tenant_id, refresh_token, refresh_token_expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [effectiveSessionId, userId, targetMembership.tenant_id, refreshToken, expiresAt],
        );
      }

      const tokens = this.buildTokenPair(
        user,
        effectiveSessionId,
        projectRef,
        memberships,
        targetMembership,
      );
      tokens.refresh_token = refreshToken;
      return tokens;
    });
  }

  async getUserTenants(
    projectIdentifier: string,
    userId: string,
  ): Promise<TenantMembershipSummary[]> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      return this.fetchUserMemberships(client, userId);
    });
  }

  async logout(projectIdentifier: string, refreshToken: string): Promise<void> {
    await this.withProjectClient(projectIdentifier, async (client) => {
      await client.query('DELETE FROM auth.sessions WHERE refresh_token = $1', [refreshToken]);
    });
  }

  async getUser(
    projectIdentifier: string,
    userId: string,
  ): Promise<AppUser & { tenants?: TenantMembershipSummary[] }> {
    return this.withProjectClient(projectIdentifier, async (client) => {
      const result = await client.query<AppUser>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned
         FROM auth.users WHERE id = $1`,
        [userId],
      );
      if (!result.rows[0]) throw new NotFoundException('User not found');
      const memberships = await this.fetchUserMemberships(client, userId);
      return {
        ...result.rows[0],
        tenants: memberships,
      };
    });
  }

  async updateUser(
    projectIdentifier: string,
    userId: string,
    data: { full_name?: string; email?: string },
  ): Promise<AppUser> {
    return this.withProjectClient(projectIdentifier, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.full_name !== undefined) {
        sets.push(`full_name = $${idx++}`);
        values.push(data.full_name);
      }
      if (data.email !== undefined) {
        const normalizedEmail = data.email.trim().toLowerCase();
        const dup = await client.query(
          'SELECT id FROM auth.users WHERE LOWER(email) = $1 AND id != $2',
          [normalizedEmail, userId],
        );
        if (dup.rowCount && dup.rowCount > 0) throw new ConflictException('Email already in use');
        sets.push(`email = $${idx++}`);
        values.push(normalizedEmail);
      }

      if (sets.length === 0) throw new BadRequestException('Nothing to update');

      sets.push(`updated_at = NOW()`);
      values.push(userId);

      const result = await client.query<AppUser>(
        `UPDATE auth.users SET ${sets.join(', ')} WHERE id = $${idx}
         RETURNING id, email, full_name, email_confirmed_at, created_at, updated_at, last_sign_in_at, is_banned`,
        values,
      );
      return result.rows[0]!;
    });
  }

  async changePassword(
    projectIdentifier: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.withProjectClient(projectIdentifier, async (client) => {
      const result = await client.query<{ encrypted_password: string }>(
        'SELECT encrypted_password FROM auth.users WHERE id = $1',
        [userId],
      );
      const user = result.rows[0];
      if (!user) throw new NotFoundException('User not found');

      const valid = await argon2.verify(user.encrypted_password, currentPassword);
      if (!valid) throw new UnauthorizedException('Current password is incorrect');

      const hash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });

      await client.query(
        'UPDATE auth.users SET encrypted_password = $1, updated_at = NOW() WHERE id = $2',
        [hash, userId],
      );
      // Invalidate all sessions
      await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [userId]);
    });
  }

  async requestPasswordReset(
    projectIdentifier: string,
    email: string,
  ): Promise<{ message: string; recovery_token?: string }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const normalizedEmail = email.trim().toLowerCase();

      const res = await client.query<{ id: string; email: string }>(
        'SELECT id, email FROM auth.users WHERE LOWER(email) = $1',
        [normalizedEmail],
      );

      if (res.rows[0]) {
        const rawToken = randomBytes(32).toString('base64url');
        const tokenHash = this.hashToken(rawToken);

        await client.query(
          `UPDATE auth.users
           SET reset_password_token = $1, reset_password_sent_at = NOW(), updated_at = NOW()
           WHERE id = $2`,
          [tokenHash, res.rows[0].id],
        );

        await this.mailService?.sendPasswordResetEmail(res.rows[0].email, rawToken).catch(() => {});

        if (this.config.get<string>('NODE_ENV', 'development') !== 'production') {
          return {
            message: 'If the email exists, password reset instructions were sent.',
            recovery_token: rawToken,
          };
        }
      }

      return { message: 'If the email exists, password reset instructions were sent.' };
    });
  }

  async resetPassword(
    projectIdentifier: string,
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const tokenHash = this.hashToken(token);

      const res = await client.query<{ id: string; reset_password_sent_at: Date }>(
        `SELECT id, reset_password_sent_at
         FROM auth.users
         WHERE reset_password_token = $1`,
        [tokenHash],
      );

      const user = res.rows[0];
      if (!user) throw new BadRequestException('Invalid or expired password reset token');

      const oneHourAgo = new Date(Date.now() - 3600 * 1000);
      if (!user.reset_password_sent_at || user.reset_password_sent_at < oneHourAgo) {
        throw new BadRequestException('Password reset token has expired');
      }

      const hash = await argon2.hash(newPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });

      await client.query(
        `UPDATE auth.users
         SET encrypted_password = $1,
             reset_password_token = NULL,
             reset_password_sent_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [hash, user.id],
      );

      // Revoke all active sessions on password reset
      await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [user.id]);

      return { message: 'Password reset successfully' };
    });
  }

  async verifyEmail(projectIdentifier: string, token: string): Promise<{ message: string }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const tokenHash = this.hashToken(token);

      const res = await client.query<{ id: string }>(
        `UPDATE auth.users
         SET email_confirmed_at = NOW(),
             confirmation_token = NULL,
             updated_at = NOW()
         WHERE confirmation_token = $1
         RETURNING id`,
        [tokenHash],
      );

      if (!res.rowCount || res.rowCount === 0) {
        throw new BadRequestException('Invalid email confirmation token');
      }

      return { message: 'Email confirmed successfully' };
    });
  }

  async resendVerification(
    projectIdentifier: string,
    userId: string,
  ): Promise<{ message: string; verification_token?: string }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const res = await client.query<{ id: string; email: string }>(
        'SELECT id, email FROM auth.users WHERE id = $1',
        [userId],
      );
      const user = res.rows[0];
      if (!user) throw new NotFoundException('User not found');

      const rawToken = randomBytes(32).toString('base64url');
      const tokenHash = this.hashToken(rawToken);

      await client.query(
        `UPDATE auth.users
         SET confirmation_token = $1, confirmation_sent_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [tokenHash, user.id],
      );

      await this.mailService?.sendVerificationEmail(user.email, rawToken).catch(() => {});

      if (this.config.get<string>('NODE_ENV', 'development') !== 'production') {
        return { message: 'Verification email sent', verification_token: rawToken };
      }

      return { message: 'Verification email sent' };
    });
  }

  async listUsers(
    projectIdentifier: string,
    page = 1,
    limit = 20,
  ): Promise<{ users: AppUser[]; total: number }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const offset = (page - 1) * limit;
      const usersResult = await client.query<AppUser>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned
         FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const countResult = await client.query<{ count: string }>(
        'SELECT COUNT(*)::text as count FROM auth.users',
      );

      return {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0]?.count ?? '0', 10),
      };
    });
  }

  async banUser(projectIdentifier: string, userId: string, banned: boolean): Promise<void> {
    await this.withProjectClient(projectIdentifier, async (client) => {
      await client.query(
        'UPDATE auth.users SET is_banned = $1, updated_at = NOW() WHERE id = $2',
        [banned, userId],
      );
      if (banned) {
        await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [userId]);
      }
    });
  }

  async deleteUser(projectIdentifier: string, userId: string): Promise<void> {
    await this.withProjectClient(projectIdentifier, async (client) => {
      await client.query('DELETE FROM auth.users WHERE id = $1', [userId]);
    });
  }

  async getStats(
    projectIdentifier: string,
  ): Promise<{ totalUsers: number; confirmedUsers: number; dailyActiveUsers: number }> {
    return this.withProjectClient(projectIdentifier, async (client, projectRef) => {
      await this.ensureSchema(client, projectRef);
      const res = await client.query<{
        total: string;
        confirmed: string;
        active: string;
      }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE email_confirmed_at IS NOT NULL)::text AS confirmed,
          COUNT(*) FILTER (WHERE last_sign_in_at >= NOW() - INTERVAL '24 hours')::text AS active
        FROM auth.users
      `);
      const row = res.rows[0];
      return {
        totalUsers: parseInt(row?.total ?? '0', 10),
        confirmedUsers: parseInt(row?.confirmed ?? '0', 10),
        dailyActiveUsers: parseInt(row?.active ?? '0', 10),
      };
    });
  }
}
