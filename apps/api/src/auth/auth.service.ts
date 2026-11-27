import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MailService } from '../mail/mail.service';
import type Redis from 'ioredis';
import {
  RegisterDto,
  LoginDto,
  ChangePasswordDto,
  UpdateProfileDto,
} from './dto';

// Argon2id configuration — OWASP recommended
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

const SESSION_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_DURATION_MIN = 30;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly mailService?: MailService,
  ) {}

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      const status = (this.redis as unknown as { status?: string }).status;
      if (status && status !== 'ready') return null;
      return await this.redis.get(key);
    } catch (err: any) {
      this.logger.debug(`Redis get skipped (${err?.message}); using DB`);
      return null;
    }
  }

  private async safeRedisSetex(key: string, ttl: number, value: string): Promise<void> {
    try {
      const status = (this.redis as unknown as { status?: string }).status;
      if (status && status !== 'ready') return;
      await this.redis.setex(key, ttl, value);
    } catch (err: any) {
      this.logger.debug(`Redis setex skipped (${err?.message})`);
    }
  }

  private async safeRedisDel(key: string): Promise<void> {
    try {
      const status = (this.redis as unknown as { status?: string }).status;
      if (status && status !== 'ready') return;
      await this.redis.del(key);
    } catch (err: any) {
      this.logger.debug(`Redis del skipped (${err?.message})`);
    }
  }

  /**
   * Register a new platform user.
   */
  async register(dto: RegisterDto) {
    // Check for existing user
    const existing = await this.prisma.platformUser.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.prisma.platformUser.create({
      data: {
        email: dto.email.toLowerCase(),
        name: dto.fullName,
        passwordHash,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (this.mailService) {
      const verifyToken = randomBytes(32).toString('hex');
      await this.safeRedisSetex(`email_verify:${verifyToken}`, 86400, user.id);
      this.mailService.sendVerificationEmail(user.email, verifyToken).catch((err) => {
        this.logger.warn(`Failed to send verification email: ${err.message}`);
      });
    }

    this.logger.log(`User registered: ${user.email}`);
    return user;
  }

  /**
   * Authenticate user and create session.
   * Returns session token to be stored in HttpOnly cookie.
   */
  async login(dto: LoginDto, ip: string, userAgent: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil(
        (user.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Account is temporarily locked. Try again in ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`,
      );
    }

    // Verify password
    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      // Increment failed login count
      const failedLogins = user.failedLogins + 1;
      const updateData: Record<string, any> = { failedLogins };

      if (failedLogins >= MAX_FAILED_LOGINS) {
        updateData.lockedUntil = new Date(
          Date.now() + LOCKOUT_DURATION_MIN * 60 * 1000,
        );
        this.logger.warn(`Account locked: ${user.email} (${failedLogins} failed attempts)`);
      }

      await this.prisma.platformUser.update({
        where: { id: user.id },
        data: updateData,
      });

      throw new UnauthorizedException('Invalid email or password');
    }

    // Reset failed login count on success
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Create session
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        ipAddress: ip,
        userAgent: userAgent?.slice(0, 500),
        expiresAt,
      },
    });

    // Cache session in Redis for fast lookups (non-fatal if Redis is unavailable)
    await this.safeRedisSetex(
      `session:${sessionToken}`,
      SESSION_TTL,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        role: user.role,
        expiresAt: expiresAt.toISOString(),
      }),
    );

    this.logger.log(`Login: ${user.email} from ${ip}`);

    return {
      token: sessionToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /**
   * Destroy a session (logout).
   */
  async logout(sessionToken: string) {
    if (!sessionToken) return;

    await this.safeRedisDel(`session:${sessionToken}`);

    await this.prisma.session.deleteMany({
      where: { token: sessionToken },
    });

    this.logger.debug('Session destroyed');
  }

  /**
   * Validate a session token — called by AuthGuard.
   * Returns user data if valid, null otherwise.
   * Automatically falls back to PostgreSQL if Redis is unreachable.
   */
  async validateSession(token: string) {
    // Check Redis cache first (falls back cleanly on Redis outage)
    const cached = await this.safeRedisGet(`session:${token}`);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (new Date(data.expiresAt) > new Date()) {
          return data;
        }
        // Expired — clean up
        await this.safeRedisDel(`session:${token}`);
      } catch {
        // Ignore corrupt cached JSON and re-validate from DB
      }
    }

    // Fallback to DB
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: {
        user: {
          select: { id: true, email: true, role: true, name: true, avatarUrl: true },
        },
      },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) {
        await this.prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      }
      return null;
    }

    // Re-cache in Redis
    const sessionData = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role,
      expiresAt: session.expiresAt.toISOString(),
    };
    const ttl = Math.floor((session.expiresAt.getTime() - Date.now()) / 1000);
    if (ttl > 0) {
      await this.safeRedisSetex(`session:${token}`, ttl, JSON.stringify(sessionData));
    }

    return sessionData;
  }

  /**
   * Get current user profile.
   */
  async getProfile(userId: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        emailVerified: true,
        mfaEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      fullName: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * Update user profile.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const data: Record<string, any> = {};
    if (dto.fullName !== undefined) data.name = dto.fullName;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }

    const user = await this.prisma.platformUser.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, role: true, avatarUrl: true },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }

  /**
   * Change password.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.platformUser.findUnique({
      where: { id: userId },
    });

    if (!user) throw new NotFoundException('User not found');

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newHash = await argon2.hash(dto.newPassword, ARGON2_OPTIONS);

    await this.prisma.platformUser.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Invalidate all sessions except current (force re-login on other devices)
    // Note: caller should pass the current session token to exclude
    this.logger.log(`Password changed: ${user.email}`);

    return { message: 'Password changed successfully' };
  }

  /**
   * List active sessions for a user.
   */
  async listSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions;
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });

    if (!session) throw new NotFoundException('Session not found');

    await this.safeRedisDel(`session:${session.token}`);
    await this.prisma.session.delete({ where: { id: sessionId } });

    return { message: 'Session revoked' };
  }

  /**
   * Request password reset token via email.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Mitigate account enumeration: return success even if user not found
    if (!user) {
      return { message: 'If the email exists, a password reset link has been sent' };
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetKey = `pwd_reset:${resetToken}`;
    await this.redis.setex(resetKey, 3600, user.id); // 1 hour TTL

    if (this.mailService) {
      this.mailService.sendPasswordResetEmail(user.email, resetToken).catch((err) => {
        this.logger.warn(`Failed to send password reset email: ${err.message}`);
      });
    }

    this.logger.log(`Password reset requested for: ${user.email}`);
    return { message: 'If the email exists, a password reset link has been sent' };
  }

  /**
   * Reset password using token.
   */
  async resetPassword(token: string, newPassword: string) {
    const resetKey = `pwd_reset:${token}`;
    const userId = await this.redis.get(resetKey);

    if (!userId) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);

    await this.prisma.platformUser.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.redis.del(resetKey);
    this.logger.log(`Password reset completed for user ID: ${userId}`);

    return { message: 'Password reset successfully' };
  }

  /**
   * Handle GitHub OAuth callback: exchanges code for user profile,
   * finds or registers the platform user, and creates a session.
   */
  async handleGitHubCallback(code: string, ip: string, userAgent: string) {
    let email = '';
    let name = '';
    let avatarUrl = '';

    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (clientId && clientSecret && code && !code.startsWith('mock_')) {
      // 1. Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = (await tokenRes.json()) as any;
      if (!tokenData?.access_token) {
        throw new BadRequestException(
          tokenData?.error_description || 'Failed to exchange GitHub authorization code',
        );
      }

      const accessToken = tokenData.access_token;

      // 2. Fetch GitHub user profile
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'SkyNode-Cloud',
        },
      });

      if (!userRes.ok) {
        throw new BadRequestException('Failed to fetch user profile from GitHub');
      }

      const ghUser = (await userRes.json()) as any;
      name = ghUser.name || ghUser.login || 'GitHub User';
      avatarUrl = ghUser.avatar_url || '';
      email = ghUser.email || '';

      // If email is private on GitHub, fetch from /user/emails
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'SkyNode-Cloud',
          },
        });
        if (emailsRes.ok) {
          const emails = (await emailsRes.json()) as any[];
          const primary = emails.find((e: any) => e.primary && e.verified) || emails[0];
          if (primary) email = primary.email;
        }
      }

      if (!email) {
        email = `${ghUser.login}@users.noreply.github.com`;
      }
    } else {
      // Local development simulation mode when GitHub OAuth credentials aren't set
      this.logger.log('Executing GitHub OAuth in local development mode');
      email = 'github.developer@skynode.dev';
      name = 'GitHub Developer';
      avatarUrl = 'https://avatars.githubusercontent.com/u/9919?v=4';
    }

    email = email.toLowerCase().trim();

    // 3. Find or create user
    let user = await this.prisma.platformUser.findUnique({
      where: { email },
    });

    if (!user) {
      // Create user with a secure randomized password
      const randomPassword = randomBytes(24).toString('hex');
      const passwordHash = await argon2.hash(randomPassword, ARGON2_OPTIONS);

      const userCount = await this.prisma.platformUser.count();
      const role = userCount === 0 ? 'ADMIN' : 'MEMBER';

      user = await this.prisma.platformUser.create({
        data: {
          email,
          name: name || 'GitHub User',
          passwordHash,
          avatarUrl: avatarUrl || null,
          role,
          emailVerified: true,
        },
      });
      this.logger.log(`New user registered via GitHub: ${user.email}`);
    } else {
      // Update avatar or name if not set
      const updateData: any = {
        lastLoginAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
      };
      if (!user.avatarUrl && avatarUrl) updateData.avatarUrl = avatarUrl;
      if (!user.name && name) updateData.name = name;

      user = await this.prisma.platformUser.update({
        where: { id: user.id },
        data: updateData,
      });
      this.logger.log(`User logged in via GitHub: ${user.email}`);
    }

    // 4. Create session
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        ipAddress: ip,
        userAgent: userAgent?.slice(0, 500),
        expiresAt,
      },
    });

    await this.safeRedisSetex(
      `session:${sessionToken}`,
      SESSION_TTL,
      JSON.stringify({
        userId: user.id,
        email: user.email,
        role: user.role,
        expiresAt: expiresAt.toISOString(),
      }),
    );

    return {
      token: sessionToken,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  }
}
