import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { TenantApiGuard, ResolvedApiContext } from './guards/tenant-api.guard';
import { ApiGatewayService } from './api-gateway.service';
import { RealtimeService } from '../realtime/realtime.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';
import {
  ensureProjectDataPlaneSchema,
  clearProjectSchemaInitCache,
} from '../projects/provisioning/project-schema.initializer';

/**
 * Security & Isolation Test Suite covering the Multi-Tenant Threat Matrix:
 * - Cross-tenant header spoofing (X-Tenant-ID) blocked server-side
 * - Anonymous key cannot inject tenant context or bypass RLS
 * - Invalid / revoked API keys & logged-out sessions rejected
 * - REST CRUD enforces PostgreSQL session context (`SET LOCAL ROLE` + `set_config`)
 * - RLS policy violations (42501) map to 403 Forbidden; hidden rows return 404 (no leakage)
 * - Internal schemas (`auth`, `pg_catalog`) blocked for non-service-role requests
 * - Realtime WebSocket channels reject cross-tenant / cross-project subscriptions & broadcasts
 * - Pooled transactions never leak `SET LOCAL` state or fall back on query errors
 */
describe('Universal Multi-Tenant Security & Isolation Suite', () => {
  const JWT_SECRET = 'test-jwt-secret';
  const PROJECT_REF = 'p12345678901';
  const TENANT_A_ID = '11111111-1111-1111-1111-111111111111';
  const TENANT_B_ID = '22222222-2222-2222-2222-222222222222';
  const USER_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  const creds = {
    host: 'localhost',
    port: 5432,
    database: `skynode_proj_${PROJECT_REF}`,
    user: `proj_${PROJECT_REF}_admin`,
    password: 'db-password',
  };

  function signUserJwt(claims: Record<string, unknown>, secretSuffix = PROJECT_REF) {
    return jwt.sign(claims, `${JWT_SECRET}:${secretSuffix}`, {
      expiresIn: 3600,
      issuer: `skynode:${secretSuffix}`,
      algorithm: 'HS256',
    });
  }

  function createMockExecutionContext(req: Record<string, any>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
  }

  describe('1. TenantApiGuard (Zero-Trust Context Validation)', () => {
    let guard: TenantApiGuard;
    let mockClient: { query: jest.Mock };
    let mockProjectsService: { validateApiKey: jest.Mock; findOne: jest.Mock };
    let mockAppAuthService: { resolveProject: jest.Mock; verifyToken: jest.Mock };
    let mockAuthService: { validateSession: jest.Mock };

    beforeEach(() => {
      mockClient = { query: jest.fn() };
      const connManager = {
        withClient: jest.fn((_c: any, fn: any) => fn(mockClient)),
      } as unknown as ProjectConnectionManager;

      mockProjectsService = {
        validateApiKey: jest.fn(),
        findOne: jest.fn(),
      };
      mockAppAuthService = {
        resolveProject: jest.fn().mockResolvedValue({
          id: 'proj-id-1',
          ref: PROJECT_REF,
          slug: 'petromanage',
          creds,
        }),
        verifyToken: jest.fn((token: string, ref: string) => {
          try {
            return jwt.verify(token, `${JWT_SECRET}:${ref}`, { issuer: `skynode:${ref}` });
          } catch {
            throw new UnauthorizedException('Invalid or expired token');
          }
        }),
      };
      mockAuthService = {
        validateSession: jest.fn(),
      };

      guard = new TenantApiGuard(
        mockAuthService as any,
        mockProjectsService as any,
        mockAppAuthService as any,
        connManager,
      );
    });

    it('rejects unauthenticated requests lacking apikey, Bearer JWT, or session', async () => {
      const ctx = createMockExecutionContext({
        params: { identifier: PROJECT_REF },
        headers: {},
        query: {},
        cookies: {},
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects revoked or forged API keys', async () => {
      mockProjectsService.validateApiKey.mockResolvedValue(null);
      const ctx = createMockExecutionContext({
        params: { identifier: PROJECT_REF },
        headers: { apikey: 'sky_anon_fake_key' },
        query: {},
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    });

    it('strictly ignores X-Tenant-ID spoofing when using Anon Key alone', async () => {
      mockProjectsService.validateApiKey.mockResolvedValue({
        projectId: 'proj-id-1',
        ref: PROJECT_REF,
        role: 'anon',
      });

      const req: any = {
        params: { identifier: PROJECT_REF },
        headers: {
          apikey: 'sky_anon_valid',
          'x-tenant-id': TENANT_B_ID,
        },
        query: {},
      };

      const allowed = await guard.canActivate(createMockExecutionContext(req));
      expect(allowed).toBe(true);
      expect(req.apiContext.apiRole).toBe('anon');
      expect(req.apiContext.tenantId).toBeNull();
      expect(req.apiContext.userId).toBeNull();
    });

    it('blocks Tenant A user attempting to spoof X-Tenant-ID header to Tenant B', async () => {
      mockProjectsService.validateApiKey.mockResolvedValue({
        projectId: 'proj-id-1',
        ref: PROJECT_REF,
        role: 'anon',
      });
      const token = signUserJwt({ sub: USER_A_ID, tenant_id: TENANT_A_ID, sid: 'sess-1' });

      // Simulate ensureSchema + auth.users + auth.sessions + empty membership for Tenant B
      mockClient.query
        .mockImplementation(async (sql: string) => {
          if (sql.includes('FROM auth.users')) return { rows: [{ is_banned: false }] };
          if (sql.includes('FROM auth.sessions'))
            return { rows: [{ refresh_token_expires_at: new Date(Date.now() + 60000) }] };
          if (sql.includes('FROM auth.tenant_users')) return { rows: [] };
          return { rows: [] };
        });

      const req: any = {
        params: { identifier: PROJECT_REF },
        headers: {
          apikey: 'sky_anon_valid',
          authorization: `Bearer ${token}`,
          'x-tenant-id': TENANT_B_ID,
        },
        query: {},
      };

      await expect(guard.canActivate(createMockExecutionContext(req))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks requests targeting a SUSPENDED tenant even if user has valid JWT', async () => {
      const token = signUserJwt({ sub: USER_A_ID, tenant_id: TENANT_A_ID, sid: 'sess-1' });

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM auth.users')) return { rows: [{ is_banned: false }] };
        if (sql.includes('FROM auth.sessions'))
          return { rows: [{ refresh_token_expires_at: new Date(Date.now() + 60000) }] };
        if (sql.includes('FROM auth.tenant_users')) {
          return {
            rows: [
              {
                tenant_id: TENANT_A_ID,
                tenant_slug: 'shell',
                tenant_status: 'SUSPENDED',
                membership_status: 'ACTIVE',
                role_id: 'r1',
                role_name: 'owner',
                permissions: ['*:*'],
              },
            ],
          };
        }
        return { rows: [] };
      });

      const req: any = {
        params: { identifier: PROJECT_REF },
        headers: { authorization: `Bearer ${token}` },
        query: {},
      };

      await expect(guard.canActivate(createMockExecutionContext(req))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects JWT signed for another project (cross-project isolation)', async () => {
      const otherProjectToken = signUserJwt({ sub: USER_A_ID }, 'p99999999999');

      const req: any = {
        params: { identifier: PROJECT_REF },
        headers: { authorization: `Bearer ${otherProjectToken}` },
        query: {},
      };

      await expect(guard.canActivate(createMockExecutionContext(req))).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('2. ApiGatewayService & ProjectConnectionManager (PostgreSQL RLS & Role Switching)', () => {
    it('executes queries in transaction with set_config claims and SET LOCAL ROLE authenticated', async () => {
      const executedQueries: string[] = [];
      const mockPgClient = {
        query: jest.fn(async (sql: string) => {
          executedQueries.push(sql.trim());
          if (sql.includes('count(*)')) return { rows: [{ total: 1 }] };
          if (sql.includes('SELECT')) return { rows: [{ id: 'sale-1', tenant_id: TENANT_A_ID }] };
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const connManager = new ProjectConnectionManager({ get: jest.fn() } as any);
      jest.spyOn(connManager, 'getPool').mockReturnValue({
        connect: jest.fn().mockResolvedValue(mockPgClient),
      } as any);

      const realtime = new RealtimeService();
      const apiGateway = new ApiGatewayService(connManager, realtime);

      const ctx: ResolvedApiContext = {
        projectId: 'proj-1',
        projectRef: PROJECT_REF,
        creds,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
        tenantRole: 'owner',
      };

      const res = await apiGateway.getRows(ctx, 'public', 'fuel_sales', {});

      expect(res.data).toHaveLength(1);
      expect(executedQueries[0]).toBe('BEGIN');
      expect(executedQueries[1]).toContain("set_config('request.jwt.claim.tenant_id'");
      expect(executedQueries).toContain(`SET LOCAL ROLE "proj_${PROJECT_REF}_authenticated"`);
      expect(executedQueries[executedQueries.length - 1]).toBe('COMMIT');
      expect(mockPgClient.release).toHaveBeenCalledTimes(1);
    });

    it('blocks non-service-role callers from directly querying internal auth schema via REST', async () => {
      const connManager = {} as ProjectConnectionManager;
      const apiGateway = new ApiGatewayService(connManager, new RealtimeService());

      const ctx: ResolvedApiContext = {
        projectId: 'proj-1',
        projectRef: PROJECT_REF,
        creds,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
      };

      await expect(apiGateway.getRows(ctx, 'auth', 'users', {})).rejects.toThrow(
        ForbiddenException,
      );
      await expect(apiGateway.getRows(ctx, 'pg_catalog', 'pg_roles', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('maps PostgreSQL RLS violation (42501) on cross-tenant INSERT to ForbiddenException and rolls back', async () => {
      const executedQueries: string[] = [];
      const mockPgClient = {
        query: jest.fn(async (sql: string) => {
          executedQueries.push(sql.trim());
          if (sql.includes('INSERT INTO')) {
            const pgErr: any = new Error('new row violates row-level security policy for table "fuel_sales"');
            pgErr.code = '42501';
            throw pgErr;
          }
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const connManager = new ProjectConnectionManager({ get: jest.fn() } as any);
      jest.spyOn(connManager, 'getPool').mockReturnValue({
        connect: jest.fn().mockResolvedValue(mockPgClient),
      } as any);

      const apiGateway = new ApiGatewayService(connManager, new RealtimeService());
      const ctx: ResolvedApiContext = {
        projectId: 'proj-1',
        projectRef: PROJECT_REF,
        creds,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
      };

      await expect(
        apiGateway.insertRow(ctx, 'public', 'fuel_sales', { tenant_id: TENANT_B_ID, amount: 50 }),
      ).rejects.toThrow(ForbiddenException);
      expect(executedQueries).toContain('ROLLBACK');
    });

    it('throws NotFoundException and suppresses realtime broadcast when DELETE matches 0 rows due to RLS', async () => {
      const mockPgClient = {
        query: jest.fn(async () => ({ rows: [] })),
        release: jest.fn(),
      };

      const connManager = new ProjectConnectionManager({ get: jest.fn() } as any);
      jest.spyOn(connManager, 'getPool').mockReturnValue({
        connect: jest.fn().mockResolvedValue(mockPgClient),
      } as any);

      const realtime = new RealtimeService();
      const broadcastSpy = jest.spyOn(realtime, 'broadcast');
      const apiGateway = new ApiGatewayService(connManager, realtime);

      const ctx: ResolvedApiContext = {
        projectId: 'proj-1',
        projectRef: PROJECT_REF,
        creds,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
      };

      await expect(
        apiGateway.deleteRow(ctx, 'public', 'fuel_sales', 'tenant-b-record-id'),
      ).rejects.toThrow(NotFoundException);
      expect(broadcastSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. RealtimeService (Tenant-Partitioned WebSockets)', () => {
    function createFakeWs() {
      return {
        readyState: 1, // WebSocket.OPEN
        send: jest.fn(),
      } as any;
    }

    it('rejects subscriptions from unauthenticated clients and cross-tenant channels', () => {
      const realtime = new RealtimeService();
      const anonSocket = createFakeWs();
      const tenantASocket = createFakeWs();

      realtime.registerClient(anonSocket);
      realtime.subscribe(anonSocket, `project:${PROJECT_REF}:table:fuel_sales`);
      expect(anonSocket.send).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));

      realtime.registerClient(tenantASocket, {
        authenticated: true,
        projectRef: PROJECT_REF,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
      });

      // Attempt subscribing to Tenant B channel
      realtime.subscribe(tenantASocket, `project:${PROJECT_REF}:tenant:${TENANT_B_ID}:table:fuel_sales`);
      expect(tenantASocket.send).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));

      // Attempt subscribing to another project
      realtime.subscribe(tenantASocket, `project:pother123456:table:fuel_sales`);
      expect(tenantASocket.send).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
    });

    it('delivers Tenant A events strictly to Tenant A and never leaks to Tenant B or Anon', () => {
      const realtime = new RealtimeService();
      const wsA = createFakeWs();
      const wsB = createFakeWs();
      const wsAnon = createFakeWs();

      realtime.registerClient(wsA, {
        authenticated: true,
        projectRef: PROJECT_REF,
        apiRole: 'authenticated',
        userId: USER_A_ID,
        tenantId: TENANT_A_ID,
      });
      realtime.registerClient(wsB, {
        authenticated: true,
        projectRef: PROJECT_REF,
        apiRole: 'authenticated',
        userId: 'user-b',
        tenantId: TENANT_B_ID,
      });
      realtime.registerClient(wsAnon, {
        authenticated: true,
        projectRef: PROJECT_REF,
        apiRole: 'anon',
        userId: null,
        tenantId: null,
      });

      // Even if all subscribe to legacy project-level table channel
      realtime.subscribe(wsA, `project:${PROJECT_REF}:table:fuel_sales`);
      realtime.subscribe(wsB, `project:${PROJECT_REF}:table:fuel_sales`);
      realtime.subscribe(wsAnon, `project:${PROJECT_REF}:table:fuel_sales`);

      wsA.send.mockClear();
      wsB.send.mockClear();
      wsAnon.send.mockClear();

      realtime.broadcast({
        project: PROJECT_REF,
        tenantId: TENANT_A_ID,
        schema: 'public',
        table: 'fuel_sales',
        eventType: 'INSERT',
        record: { id: 'sale-100', tenant_id: TENANT_A_ID, total: 99 },
      });

      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsB.send).not.toHaveBeenCalled();
      expect(wsAnon.send).not.toHaveBeenCalled();
    });
  });

  describe('4. Schema Init Concurrency & Connection Fallback Resilience', () => {
    it('coalesces parallel ensureProjectDataPlaneSchema calls and skips repeated hot-path DDL', async () => {
      clearProjectSchemaInitCache('pconcurrent1');
      const ddlCalls: string[] = [];
      const mockSchemaClient = {
        query: jest.fn(async (sql: string) => {
          ddlCalls.push(sql.trim().split('\n')[0] || '');
          // Simulate slow PostgreSQL DDL so parallel calls overlap cleanly
          await new Promise((r) => setTimeout(r, 15));
          return { rows: [] };
        }),
      };

      // Launch two concurrent calls (mirrors auth/admin/users + auth/admin/stats in parallel)
      await Promise.all([
        ensureProjectDataPlaneSchema(mockSchemaClient, { ref: 'pconcurrent1' }),
        ensureProjectDataPlaneSchema(mockSchemaClient, { ref: 'pconcurrent1' }),
      ]);

      const initCallCount = ddlCalls.length;
      expect(ddlCalls[0]).toContain('pg_advisory_lock');
      expect(ddlCalls[ddlCalls.length - 1]).toContain('pg_advisory_unlock');

      // Subsequent call hits verified cache -> zero extra DDL queries
      await ensureProjectDataPlaneSchema(mockSchemaClient, { ref: 'pconcurrent1' });
      expect(ddlCalls.length).toBe(initCallCount);
      clearProjectSchemaInitCache('pconcurrent1');
    });

    it('caches unreachable project DBs and routes subsequent queries directly to defaultPool', async () => {
      const connManager = new ProjectConnectionManager({ get: jest.fn() } as any);
      const fallbackClient = { query: jest.fn(async () => ({ rows: [{ ok: 1 }] })), release: jest.fn() };
      const connectDefaultSpy = jest.fn().mockResolvedValue(fallbackClient);
      (connManager as any).defaultPool = { connect: connectDefaultSpy, end: jest.fn() };

      const projectConnectSpy = jest
        .fn()
        .mockRejectedValue(new Error('database "skynode_proj_missing" does not exist'));
      jest.spyOn(connManager, 'getPool').mockReturnValue({
        connect: projectConnectSpy,
      } as any);

      // Call 1: attempts project pool -> fails -> falls back to defaultPool
      await connManager.withClient(creds, (c) => c.query('SELECT 1'));
      expect(projectConnectSpy).toHaveBeenCalledTimes(1);
      expect(connectDefaultSpy).toHaveBeenCalledTimes(1);

      // Call 2: skips unreachable project pool immediately and goes straight to defaultPool
      await connManager.withClient(creds, (c) => c.query('SELECT 1'));
      expect(projectConnectSpy).toHaveBeenCalledTimes(1);
      expect(connectDefaultSpy).toHaveBeenCalledTimes(2);
    });
  });
});
