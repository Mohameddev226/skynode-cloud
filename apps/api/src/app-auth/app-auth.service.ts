import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'crypto';
import { ProjectConnectionManager, ProjectDbCredentials } from '../database-studio/project-connection.manager';
import { PrismaService } from '../prisma/prisma.service';
import { decrypt } from '../common/utils/crypto.util';

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

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  user: Omit<AppUser, 'is_banned'>;
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
  ) {}

  private getJwtSecret(projectRef: string): string {
    const base = this.config.get<string>('JWT_SECRET') ?? 'skynode-jwt-secret-change-in-prod';
    return `${base}:${projectRef}`;
  }

  private async getCredentials(projectRef: string): Promise<ProjectDbCredentials> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectRef);
    const or: Array<{ id?: string; slug?: string; ref?: string }> = [
      { ref: projectRef },
      { slug: projectRef },
    ];
    if (isUuid) or.push({ id: projectRef });

    const project = await this.prisma.project.findFirst({
      where: {
        status: { not: 'DELETED' },
        OR: or,
      },
    });
    if (!project) throw new NotFoundException(`Project ${projectRef} not found`);
    return {
      host: project.dbHost,
      port: project.dbPort,
      database: project.dbName,
      user: project.dbUser,
      password: decrypt(project.dbPasswordEnc),
    };
  }

  private async withProjectClient<T>(
    projectRef: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const creds = await this.getCredentials(projectRef);
    return this.connManager.withClient(creds, fn);
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

  private async ensureSchema(client: PoolClient): Promise<void> {
    await client.query(`CREATE SCHEMA IF NOT EXISTS auth;`).catch(() => {});
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`).catch(() => {});
    // Ensure auth.users and auth.sessions tables exist in provisioned DB
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT UNIQUE NOT NULL,
        email_confirmed_at TIMESTAMPTZ,
        encrypted_password TEXT NOT NULL,
        full_name TEXT,
        avatar_url TEXT,
        is_banned BOOLEAN NOT NULL DEFAULT FALSE,
        banned_until TIMESTAMPTZ,
        last_sign_in_at TIMESTAMPTZ,
        reset_password_token TEXT,
        reset_password_sent_at TIMESTAMPTZ,
        confirmation_token TEXT,
        confirmation_sent_at TIMESTAMPTZ,
        raw_user_meta_data JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth.sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        refresh_token TEXT UNIQUE NOT NULL,
        refresh_token_expires_at TIMESTAMPTZ NOT NULL,
        user_agent TEXT,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON auth.sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON auth.sessions(refresh_token);
      CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
    `);
  }

  private buildTokenPair(user: AppUser, sessionId: string, projectRef: string): TokenPair {
    const payload = {
      sub: user.id,
      email: user.email,
      full_name: user.full_name,
      role: 'authenticated',
      sid: sessionId,
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
    };
  }

  async register(
    projectRef: string,
    email: string,
    password: string,
    fullName?: string,
  ): Promise<TokenPair> {
    return this.withProjectClient(projectRef, async (client) => {
      await this.ensureSchema(client);

      // Check existing user
      const existing = await client.query('SELECT id FROM auth.users WHERE email = $1', [email]);
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ConflictException('Email already registered');
      }

      const hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
      });

      const result = await client.query<AppUser>(
        `INSERT INTO auth.users (email, encrypted_password, full_name, email_confirmed_at)
         VALUES ($1, $2, $3, NOW())
         RETURNING id, email, full_name, email_confirmed_at, created_at, updated_at, last_sign_in_at, is_banned`,
        [email, hash, fullName ?? null],
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

      const tokens = this.buildTokenPair(user, sessionId, projectRef);
      tokens.refresh_token = refreshToken;
      return tokens;
    });
  }

  async login(
    projectRef: string,
    email: string,
    password: string,
  ): Promise<TokenPair> {
    return this.withProjectClient(projectRef, async (client) => {
      await this.ensureSchema(client);

      const result = await client.query<AppUser & { encrypted_password: string }>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned, encrypted_password
         FROM auth.users WHERE email = $1`,
        [email],
      );

      const user = result.rows[0];
      if (!user) throw new UnauthorizedException('Invalid email or password');
      if (user.is_banned) throw new UnauthorizedException('Account suspended');

      const valid = await argon2.verify(user.encrypted_password, password);
      if (!valid) throw new UnauthorizedException('Invalid email or password');

      // Update last_sign_in_at
      await client.query(
        'UPDATE auth.users SET last_sign_in_at = NOW(), updated_at = NOW() WHERE id = $1',
        [user.id],
      );

      const sessionId = randomUUID();
      const refreshToken = randomBytes(48).toString('base64url');
      const expiresAt = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      await client.query(
        `INSERT INTO auth.sessions (id, user_id, refresh_token, refresh_token_expires_at)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, user.id, refreshToken, expiresAt],
      );

      const tokens = this.buildTokenPair(user, sessionId, projectRef);
      tokens.refresh_token = refreshToken;
      return tokens;
    });
  }

  async refreshToken(projectRef: string, refreshToken: string): Promise<TokenPair> {
    return this.withProjectClient(projectRef, async (client) => {
      const sessionResult = await client.query<{
        id: string;
        user_id: string;
        refresh_token_expires_at: Date;
      }>(
        `SELECT id, user_id, refresh_token_expires_at FROM auth.sessions
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

      // Rotate refresh token
      const newRefreshToken = randomBytes(48).toString('base64url');
      const newExpiry = new Date(Date.now() + this.REFRESH_TOKEN_TTL * 1000);

      await client.query(
        `UPDATE auth.sessions
         SET refresh_token = $1, refresh_token_expires_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [newRefreshToken, newExpiry, session.id],
      );

      const tokens = this.buildTokenPair(user, session.id, projectRef);
      tokens.refresh_token = newRefreshToken;
      return tokens;
    });
  }

  async logout(projectRef: string, refreshToken: string): Promise<void> {
    await this.withProjectClient(projectRef, async (client) => {
      await client.query('DELETE FROM auth.sessions WHERE refresh_token = $1', [refreshToken]);
    });
  }

  async getUser(projectRef: string, userId: string): Promise<AppUser> {
    return this.withProjectClient(projectRef, async (client) => {
      const result = await client.query<AppUser>(
        `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                last_sign_in_at, is_banned
         FROM auth.users WHERE id = $1`,
        [userId],
      );
      if (!result.rows[0]) throw new NotFoundException('User not found');
      return result.rows[0];
    });
  }

  async updateUser(
    projectRef: string,
    userId: string,
    data: { full_name?: string; email?: string },
  ): Promise<AppUser> {
    return this.withProjectClient(projectRef, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (data.full_name !== undefined) {
        sets.push(`full_name = $${idx++}`);
        values.push(data.full_name);
      }
      if (data.email !== undefined) {
        // Check uniqueness
        const dup = await client.query('SELECT id FROM auth.users WHERE email = $1 AND id != $2', [
          data.email,
          userId,
        ]);
        if (dup.rowCount && dup.rowCount > 0) throw new ConflictException('Email already in use');
        sets.push(`email = $${idx++}`);
        values.push(data.email);
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
    projectRef: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.withProjectClient(projectRef, async (client) => {
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

  async listUsers(
    projectRef: string,
    page = 1,
    limit = 20,
  ): Promise<{ users: AppUser[]; total: number }> {
    return this.withProjectClient(projectRef, async (client) => {
      await this.ensureSchema(client);
      const offset = (page - 1) * limit;
      const [usersResult, countResult] = await Promise.all([
        client.query<AppUser>(
          `SELECT id, email, full_name, email_confirmed_at, created_at, updated_at,
                  last_sign_in_at, is_banned
           FROM auth.users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        client.query<{ count: string }>('SELECT COUNT(*)::text as count FROM auth.users'),
      ]);

      return {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0]?.count ?? '0', 10),
      };
    });
  }

  async banUser(projectRef: string, userId: string, banned: boolean): Promise<void> {
    await this.withProjectClient(projectRef, async (client) => {
      await client.query(
        'UPDATE auth.users SET is_banned = $1, updated_at = NOW() WHERE id = $2',
        [banned, userId],
      );
      if (banned) {
        await client.query('DELETE FROM auth.sessions WHERE user_id = $1', [userId]);
      }
    });
  }

  async deleteUser(projectRef: string, userId: string): Promise<void> {
    await this.withProjectClient(projectRef, async (client) => {
      await client.query('DELETE FROM auth.users WHERE id = $1', [userId]);
    });
  }

  async getStats(
    projectRef: string,
  ): Promise<{ totalUsers: number; confirmedUsers: number; dailyActiveUsers: number }> {
    return this.withProjectClient(projectRef, async (client) => {
      await this.ensureSchema(client);
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
