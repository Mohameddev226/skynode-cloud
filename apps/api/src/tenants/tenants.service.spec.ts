import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import { AppAuthService } from '../app-auth/app-auth.service';
import type { TenantCallerContext } from './guards/tenant-access.guard';

jest.mock('../projects/provisioning/project-schema.initializer', () => ({
  ensureProjectDataPlaneSchema: jest.fn().mockResolvedValue(undefined),
}));

const mockClient = {
  query: jest.fn(),
};

const mockConnManager = {
  withClient: jest.fn((_creds: any, fn: (client: any) => Promise<any>) => fn(mockClient)),
};

const mockAppAuthService = {
  resolveProject: jest.fn().mockResolvedValue({
    id: 'proj-1',
    ref: 'ptest1234567',
    slug: 'petromanage',
    creds: {
      host: 'localhost',
      port: 5432,
      database: 'skynode_proj_ptest1234567',
      user: 'proj_ptest1234567_admin',
      password: 'secret',
    },
  }),
};

describe('TenantsService (Universal Tenant Management & RBAC)', () => {
  let service: TenantsService;

  const serviceCaller: TenantCallerContext = {
    mode: 'service_role',
    projectId: 'proj-1',
    projectRef: 'ptest1234567',
  };

  const userCaller: TenantCallerContext = {
    mode: 'authenticated',
    projectId: 'proj-1',
    projectRef: 'ptest1234567',
    userId: 'user-alice',
    email: 'alice@company-a.com',
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: ProjectConnectionManager, useValue: mockConnManager },
        { provide: AppAuthService, useValue: mockAppAuthService },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
    jest.clearAllMocks();
  });

  it('blocks self-serve tenant creation when allow_self_serve_tenants is false', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ value: { allow_self_serve_tenants: false } }],
    });

    await expect(
      service.createTenant('petromanage', userCaller, { name: 'Unauthorized Corp' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows service_role to create tenant even when self-serve is disabled', async () => {
    const tenantRow = {
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'shell-somalia',
      name: 'Shell Somalia',
      status: 'ACTIVE',
      plan: 'STANDARD',
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // slug check
      .mockResolvedValueOnce({ rows: [tenantRow] }) // insert tenant
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'owner-u1' }] }) // verify owner exists
      .mockResolvedValueOnce({ rows: [{ id: 'role-owner-id', name: 'owner' }] }) // resolveRole
      .mockResolvedValueOnce({ rows: [{ id: 'mem-1', user_id: 'owner-u1' }] }) // insert membership
      .mockResolvedValueOnce({}); // COMMIT

    const created = await service.createTenant('petromanage', serviceCaller, {
      name: 'Shell Somalia',
      slug: 'shell-somalia',
      owner_user_id: 'owner-u1',
    });

    expect(created.slug).toBe('shell-somalia');
    expect(created.owner_membership).toBeDefined();
  });

  it('prevents non-service_role from suspending or activating tenants', async () => {
    await expect(
      service.updateTenantStatus('petromanage', userCaller, 'shell-somalia', 'SUSPENDED'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents non-owners (e.g. tenant admin) from promoting another user to owner', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 't1', slug: 'shell', name: 'Shell', status: 'ACTIVE' }],
      }) // resolveTenant
      .mockResolvedValueOnce({
        rows: [{ status: 'ACTIVE', role_id: 'r-admin', role_name: 'admin' }],
      }) // assertTenantAccess
      .mockResolvedValueOnce({
        rows: [{ id: 'user-bob', email: 'bob@shell.com', full_name: 'Bob' }],
      }) // user lookup
      .mockResolvedValueOnce({
        rows: [{ id: 'r-owner', name: 'owner' }],
      }); // resolveRole

    await expect(
      service.addMember('petromanage', userCaller, 'shell', {
        email: 'bob@shell.com',
        role: 'owner',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prevents removing the last active owner of a tenant by regular users', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 't1', slug: 'shell', name: 'Shell', status: 'ACTIVE' }],
      }) // resolveTenant
      .mockResolvedValueOnce({
        rows: [{ status: 'ACTIVE', role_id: 'r-owner', role_name: 'owner' }],
      }) // assertTenantAccess (self leave)
      .mockResolvedValueOnce({ rows: [{ cnt: 1 }] }) // ownersCount
      .mockResolvedValueOnce({ rows: [{ is_owner: true }] }); // targetIsOwner

    await expect(
      service.removeMember('petromanage', userCaller, 'shell', 'user-alice'),
    ).rejects.toThrow(BadRequestException);
  });

  it('forbids accepting an invitation addressed to a different email', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'inv-1',
            tenant_id: 't1',
            email: 'someone-else@company-b.com',
            role_id: 'r-member',
            custom_attributes: {},
            expires_at: new Date(Date.now() + 60000),
            accepted_at: null,
          },
        ],
      }) // invitation query
      .mockResolvedValueOnce({
        rows: [{ id: 'user-alice', email: 'alice@company-a.com' }],
      }) // current user query
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      service.acceptInvitation('petromanage', userCaller, 'token-123'),
    ).rejects.toThrow(ForbiddenException);
  });
});
