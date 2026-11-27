import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { AppAuthService } from './app-auth.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('../common/utils/crypto.util', () => ({
  encrypt: jest.fn((s: string) => `enc:${s}`),
  decrypt: jest.fn((_s: string) => 'decrypted-password'),
}));

jest.mock('../projects/provisioning/project-schema.initializer', () => ({
  ensureProjectDataPlaneSchema: jest.fn().mockResolvedValue(undefined),
}));

const mockClient = {
  query: jest.fn(),
};

const mockConnManager = {
  withClient: jest.fn((_creds: any, fn: (client: any) => Promise<any>) => fn(mockClient)),
  hasFallbackPool: jest.fn(() => true),
};

const mockConfig = {
  get: jest.fn((key: string, defaultVal?: string) => {
    if (key === 'JWT_SECRET') return 'test-secret';
    if (key === 'NODE_ENV') return 'test';
    return defaultVal;
  }),
};

const mockPrisma: any = {
  project: {
    findFirst: jest.fn().mockResolvedValue({
      id: 'proj-uuid',
      ref: 'ptest1234567',
      slug: 'petromanage',
      dbHost: 'localhost',
      dbPort: 5432,
      dbName: 'skynode_proj_ptest1234567',
      dbUser: 'proj_ptest1234567_admin',
      dbPasswordEnc: 'encrypted',
      status: 'ACTIVE',
    }),
  },
};

describe('AppAuthService (Multi-Tenant Auth)', () => {
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
    mockPrisma.project.findFirst.mockResolvedValue({
      id: 'proj-uuid',
      ref: 'ptest1234567',
      slug: 'petromanage',
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

    it('returns payload with tenant claims for valid token', () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign(
        {
          sub: 'user-id',
          email: 'test@test.com',
          tenant_id: 'tenant-a-id',
          tenant_role: 'owner',
        },
        'test-secret:proj-ref',
        { expiresIn: 3600, issuer: 'skynode:proj-ref', algorithm: 'HS256' },
      );
      const payload = service.verifyToken(token, 'proj-ref');
      expect(payload.sub).toBe('user-id');
      expect(payload['tenant_id']).toBe('tenant-a-id');
      expect(payload['tenant_role']).toBe('owner');
    });
  });

  describe('register', () => {
    it('throws ConflictException if email exists', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'existing' }] });

      await expect(service.register('ptest1234567', 'x@x.com', 'password123')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates user and returns token pair with tenant arrays', async () => {
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
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // check email
        .mockResolvedValueOnce({ rows: [fakeUser] }) // insert user
        .mockResolvedValueOnce({ rowCount: 1 }); // insert session

      const result = await service.register('ptest1234567', 'new@test.com', 'password123');
      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result.user.email).toBe('new@test.com');
      expect(result.active_tenant).toBeNull();
      expect(result.tenants).toEqual([]);
    });
  });

  describe('login & multi-tenant context', () => {
    it('throws UnauthorizedException for missing user', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.login('ptest1234567', 'x@x.com', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues tenant-scoped JWT when user belongs to active tenant', async () => {
      const passwordHash = await argon2.hash('correct-pass', { type: argon2.argon2id });
      const fakeUser = {
        id: 'user-1',
        email: 'owner@shell.com',
        full_name: 'Shell Owner',
        email_confirmed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
        last_sign_in_at: null,
        is_banned: false,
        encrypted_password: passwordHash,
      };

      const membership = {
        tenant_id: 'tenant-shell-id',
        tenant_slug: 'shell',
        tenant_name: 'Shell Oil',
        tenant_status: 'ACTIVE',
        role_id: 'role-owner',
        role_name: 'owner',
        membership_status: 'ACTIVE',
        custom_attributes: {},
        permissions: ['*:*'],
      };

      mockClient.query
        .mockResolvedValueOnce({ rows: [fakeUser] }) // select user
        .mockResolvedValueOnce({ rows: [membership] }) // fetchUserMemberships
        .mockResolvedValueOnce({ rowCount: 1 }) // update last_sign_in_at
        .mockResolvedValueOnce({ rowCount: 1 }); // insert session

      const res = await service.login('petromanage', 'owner@shell.com', 'correct-pass');
      expect(res.active_tenant?.tenant_id).toBe('tenant-shell-id');
      expect(res.tenants).toHaveLength(1);

      const verified = service.verifyToken(res.access_token, 'ptest1234567');
      expect(verified['tenant_id']).toBe('tenant-shell-id');
      expect(verified['tenant_role']).toBe('owner');
      expect(verified['permissions']).toEqual(['*:*']);
    });

    it('throws ForbiddenException when logging into an unauthorized tenant', async () => {
      const passwordHash = await argon2.hash('correct-pass', { type: argon2.argon2id });
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-1',
              email: 'owner@shell.com',
              is_banned: false,
              encrypted_password: passwordHash,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ tenant_id: 'tenant-shell-id', tenant_slug: 'shell', role_name: 'owner' }],
        });

      await expect(
        service.login('petromanage', 'owner@shell.com', 'correct-pass', 'tenant-total-id'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('switchTenant', () => {
    it('forbids switching into a tenant the user is NOT a member of', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'u@test.com', is_banned: false }] })
        .mockResolvedValueOnce({
          rows: [{ tenant_id: 'tenant-a', tenant_slug: 'tenant-a', role_name: 'member' }],
        });

      await expect(
        service.switchTenant('ptest1234567', 'user-1', 'sess-1', 'tenant-b'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('mints new tenant-scoped token pair when switching to authorized tenant', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: 'user-1', email: 'u@test.com', is_banned: false }] })
        .mockResolvedValueOnce({
          rows: [
            {
              tenant_id: 'tenant-a',
              tenant_slug: 'tenant-a',
              tenant_name: 'Tenant A',
              tenant_status: 'ACTIVE',
              role_id: 'r1',
              role_name: 'member',
              membership_status: 'ACTIVE',
              custom_attributes: {},
              permissions: ['*:read'],
            },
            {
              tenant_id: 'tenant-b',
              tenant_slug: 'tenant-b',
              tenant_name: 'Tenant B',
              tenant_status: 'ACTIVE',
              role_id: 'r2',
              role_name: 'admin',
              membership_status: 'ACTIVE',
              custom_attributes: {},
              permissions: ['*:*'],
            },
          ],
        })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ refresh_token: 'rt' }] }); // update session

      const res = await service.switchTenant('petromanage', 'user-1', 'sess-1', 'tenant-b');
      expect(res.active_tenant?.tenant_id).toBe('tenant-b');
      const verified = service.verifyToken(res.access_token, 'ptest1234567');
      expect(verified['tenant_id']).toBe('tenant-b');
      expect(verified['tenant_role']).toBe('admin');
    });
  });

  describe('listUsers & getStats', () => {
    it('returns users array and total', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await service.listUsers('ptest1234567', 1, 20);
      expect(result.total).toBe(0);
    });

    it('returns user statistics', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ total: '15', confirmed: '10', active: '3' }],
      });

      const result = await service.getStats('ptest1234567');
      expect(result).toEqual({
        totalUsers: 15,
        confirmedUsers: 10,
        dailyActiveUsers: 3,
      });
    });

    it('falls back gracefully to shared DB pool when dbPasswordEnc cannot be decrypted', async () => {
      const { decrypt } = require('../common/utils/crypto.util');
      (decrypt as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Unsupported state or unable to authenticate data');
      });
      mockConnManager.hasFallbackPool.mockReturnValueOnce(true);

      const resolved = await service.resolveProject('petromanage');
      expect(resolved.creds.forceFallback).toBe(true);
    });
  });
});
