import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AppAuthService } from './app-auth.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { PrismaService } from '../prisma/prisma.service';

// Mock the crypto util so decrypt doesn't need a real AES key
jest.mock('../common/utils/crypto.util', () => ({
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((_s: string) => 'decrypted-password'),
}));

const mockClient = {
  query: jest.fn(),
};

const mockCreds = {
  host: 'localhost',
  port: 5432,
  database: 'skynode_proj_ptest1234567',
  user: 'proj_ptest1234567_admin',
  password: 'secret',
};

const mockConnManager = {
  withClient: jest.fn((_creds: any, fn: (client: any) => Promise<any>) => fn(mockClient)),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    return undefined;
  }),
};

const mockPrisma: any = {
  project: {
    findFirst: jest.fn().mockResolvedValue({
      ref: 'ptest1234567',
      dbHost: 'localhost',
      dbPort: 5432,
      dbName: 'skynode_proj_ptest1234567',
      dbUser: 'proj_ptest1234567_admin',
      dbPasswordEnc: 'encrypted',
      status: 'ACTIVE',
    }),
  },
};

describe('AppAuthService', () => {
  let service: AppAuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AppAuthService,
        { provide: ProjectConnectionManager, useValue: mockConnManager },
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AppAuthService>(AppAuthService);
    jest.clearAllMocks();
    // Restore findFirst default mock after clearAllMocks
    mockPrisma.project.findFirst.mockResolvedValue({
      ref: 'ptest1234567',
      dbHost: 'localhost',
      dbPort: 5432,
      dbName: 'skynode_proj_ptest1234567',
      dbUser: 'proj_ptest1234567_admin',
      dbPasswordEnc: 'encrypted',
      status: 'ACTIVE',
    });
  });

  describe('verifyToken', () => {
    it('throws UnauthorizedException on invalid token', () => {
      expect(() => service.verifyToken('bad-token', 'proj-ref')).toThrow(UnauthorizedException);
    });

    it('returns payload for valid token', () => {
      // Sign a real token using the service's internal method via register flow
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        { sub: 'user-id', email: 'test@test.com' },
        'test-secret:proj-ref',
        { expiresIn: 3600, issuer: 'skynode:proj-ref', algorithm: 'HS256' },
      );
      const payload = service.verifyToken(token, 'proj-ref');
      expect(payload.sub).toBe('user-id');
    });
  });

  describe('register', () => {
    it('throws ConflictException if email exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TABLE users
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TABLE sessions
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE INDEX
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing' }] }); // existing user check

      await expect(service.register('ref', 'x@x.com', 'password123')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates user and returns token pair', async () => {
      const fakeUser = {
        id: 'uuid-1',
        email: 'new@test.com',
        full_name: null,
        email_confirmed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        last_sign_in_at: null,
        is_banned: false,
      };

      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TABLE users
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TABLE sessions
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE INDEX
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no existing user
        .mockResolvedValueOnce({ rows: [fakeUser] }) // insert user
        .mockResolvedValueOnce({ rowCount: 1 }); // insert session

      const result = await service.register('ref', 'new@test.com', 'password123');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.user.email).toBe('new@test.com');
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException for missing user', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // CREATE TABLE
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rows: [] }); // no user

      await expect(service.login('ref', 'x@x.com', 'pass')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('listUsers', () => {
    it('returns users array and total', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // ensure schema users
        .mockResolvedValueOnce({ rowCount: 0 }) // ensure schema sessions
        .mockResolvedValueOnce({ rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [] }) // users
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count

      const result = await service.listUsers('ref', 1, 20);
      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('total');
      expect(result.total).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns user statistics', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 0 }) // ensure schema users
        .mockResolvedValueOnce({ rowCount: 0 }) // ensure schema sessions
        .mockResolvedValueOnce({ rowCount: 0 }) // indexes
        .mockResolvedValueOnce({ rows: [{ total: '15', confirmed: '10', active: '3' }] });

      const result = await service.getStats('ref');
      expect(result).toEqual({
        totalUsers: 15,
        confirmedUsers: 10,
        dailyActiveUsers: 3,
      });
    });
  });
});
