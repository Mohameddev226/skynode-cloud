import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { MailService } from '../mail/mail.service';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

describe('AuthService', () => {
  let service: AuthService;

  const mockPrisma = {
    platformUser: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  };

  const mockMail = {
    sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should throw ConflictException if user already exists', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue({ id: '1', email: 'test@skynode.cloud' });

      await expect(
        service.register({
          fullName: 'Test User',
          email: 'test@skynode.cloud',
          password: 'Password123!',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should hash password and create platform user', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue(null);
      mockPrisma.platformUser.create.mockResolvedValue({
        id: 'user-uuid',
        email: 'test@skynode.cloud',
        name: 'Test User',
        role: 'MEMBER',
        createdAt: new Date(),
      });

      const res = await service.register({
        fullName: 'Test User',
        email: 'test@skynode.cloud',
        password: 'Password123!',
      });

      expect(res.id).toBe('user-uuid');
      expect(mockPrisma.platformUser.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@skynode.cloud',
            name: 'Test User',
          }),
        }),
      );
    });
  });

  describe('login', () => {
    it('should reject invalid credentials if user not found', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@skynode.cloud', password: 'password' }, '127.0.0.1', 'jest'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject if account is locked', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue({
        id: '1',
        email: 'locked@skynode.cloud',
        lockedUntil: new Date(Date.now() + 600000),
      });

      await expect(
        service.login({ email: 'locked@skynode.cloud', password: 'password' }, '127.0.0.1', 'jest'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should create session and cache in redis on valid login', async () => {
      const password = 'CorrectPassword123!';
      const passwordHash = await argon2.hash(password);

      mockPrisma.platformUser.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@skynode.cloud',
        name: 'User One',
        passwordHash,
        role: 'OWNER',
        failedLogins: 0,
        lockedUntil: null,
      });

      mockPrisma.platformUser.update.mockResolvedValue({});
      mockPrisma.session.create.mockResolvedValue({});
      mockRedis.setex.mockResolvedValue('OK');

      const result = await service.login(
        { email: 'user@skynode.cloud', password },
        '127.0.0.1',
        'jest-agent',
      );

      expect(result.token).toBeDefined();
      expect(result.user.email).toBe('user@skynode.cloud');
      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  describe('validateSession', () => {
    it('should return session from Redis cache if available and not expired', async () => {
      const future = new Date(Date.now() + 100000).toISOString();
      mockRedis.get.mockResolvedValue(
        JSON.stringify({ userId: 'u1', email: 'u1@test.com', role: 'ADMIN', expiresAt: future }),
      );

      const session = await service.validateSession('token-123');
      expect(session).toEqual({
        userId: 'u1',
        email: 'u1@test.com',
        role: 'ADMIN',
        expiresAt: future,
      });
      expect(mockPrisma.session.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('should return confirmation message and trigger email if user exists', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue({ id: 'u1', email: 'test@skynode.cloud' });
      mockRedis.setex.mockResolvedValue('OK');

      const res = await service.forgotPassword('test@skynode.cloud');
      expect(res.message).toContain('password reset link has been sent');
      expect(mockRedis.setex).toHaveBeenCalled();
      expect(mockMail.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('should return confirmation message without throwing if user does not exist', async () => {
      mockPrisma.platformUser.findUnique.mockResolvedValue(null);

      const res = await service.forgotPassword('unknown@skynode.cloud');
      expect(res.message).toContain('password reset link has been sent');
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should throw BadRequestException if token is invalid or expired', async () => {
      mockRedis.get.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'NewPassword123!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should update password and delete token on success', async () => {
      mockRedis.get.mockResolvedValue('u1');
      mockPrisma.platformUser.update.mockResolvedValue({ id: 'u1' });
      mockRedis.del.mockResolvedValue(1);

      const res = await service.resetPassword('valid-token', 'NewPassword123!');
      expect(res.message).toBe('Password reset successfully');
      expect(mockPrisma.platformUser.update).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
