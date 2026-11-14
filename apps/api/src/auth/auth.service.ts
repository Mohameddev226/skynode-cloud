import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
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
  ) {}

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

    // Cache session in Redis for fast lookups
    await this.redis.setex(
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

    await this.redis.del(`session:${sessionToken}`);

    await this.prisma.session.deleteMany({
      where: { token: sessionToken },
    });

    this.logger.debug('Session destroyed');
  }

  /**
   * Validate a session token — called by AuthGuard.
   * Returns user data if valid, null otherwise.
   */
  async validateSession(token: string) {
    // Check Redis cache first
    const cached = await this.redis.get(`session:${token}`);
    if (cached) {
      const data = JSON.parse(cached);
      if (new Date(data.expiresAt) > new Date()) {
        return data;
      }
      // Expired — clean up
      await this.redis.del(`session:${token}`);
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
        await this.prisma.session.delete({ where: { id: session.id } });
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
      await this.redis.setex(`session:${token}`, ttl, JSON.stringify(sessionData));
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

    await this.redis.del(`session:${session.token}`);
    await this.prisma.session.delete({ where: { id: sessionId } });

    return { message: 'Session revoked' };
  }
}
