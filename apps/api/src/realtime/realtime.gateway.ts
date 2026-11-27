import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { RealtimeService, RealtimeAuthSession } from './realtime.service';
import { ProjectsService } from '../projects/projects.service';
import { AppAuthService } from '../app-auth/app-auth.service';
import { ProjectConnectionManager } from '../database-studio/project-connection.manager';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly realtimeService: RealtimeService,
    private readonly projectsService: ProjectsService,
    private readonly appAuthService: AppAuthService,
    private readonly connManager: ProjectConnectionManager,
  ) {}

  private async authenticateConnection(params: {
    project?: string | null;
    apikey?: string | null;
    token?: string | null;
    tenantId?: string | null;
  }): Promise<RealtimeAuthSession> {
    if (!params.project) {
      throw new Error('Missing project identifier for realtime authentication');
    }

    const project = await this.appAuthService.resolveProject(params.project);
    let keyRole: 'anon' | 'service_role' | null = null;

    if (params.apikey) {
      const validated = await this.projectsService.validateApiKey(project.ref, params.apikey);
      if (!validated) {
        throw new Error('Invalid or revoked API key');
      }
      keyRole = validated.role;
    }

    if (params.token && !params.token.startsWith('sky_')) {
      const payload = this.appAuthService.verifyToken(params.token, project.ref);
      const userId = payload.sub;
      if (!userId) throw new Error('Invalid JWT subject');

      const requestedTenant =
        params.tenantId || (typeof payload['tenant_id'] === 'string' ? payload['tenant_id'] : null);

      let verifiedTenantId: string | null = null;
      if (requestedTenant) {
        verifiedTenantId = await this.connManager.withClient(project.creds, async (client) => {
          const isUuid = UUID_REGEX.test(requestedTenant);
          const res = await client.query<{ tenant_id: string }>(
            `SELECT tu.tenant_id
             FROM auth.tenant_users tu
             JOIN auth.tenants t ON t.id = tu.tenant_id
             WHERE tu.user_id = $1
               AND tu.status = 'ACTIVE'
               AND t.status = 'ACTIVE'
               AND ${isUuid ? '(t.id = $2 OR t.slug = $3)' : 't.slug = $2'}
             LIMIT 1`,
            isUuid ? [userId, requestedTenant, requestedTenant] : [userId, requestedTenant],
          );
          return res.rows[0]?.tenant_id ?? null;
        });

        if (!verifiedTenantId) {
          throw new Error('Access denied: not an active member of target tenant');
        }
      }

      return {
        authenticated: true,
        projectRef: project.ref,
        apiRole: 'authenticated',
        userId,
        tenantId: verifiedTenantId,
      };
    }

    if (keyRole === 'service_role') {
      return {
        authenticated: true,
        projectRef: project.ref,
        apiRole: 'service_role',
        userId: null,
        tenantId: params.tenantId && UUID_REGEX.test(params.tenantId) ? params.tenantId : null,
      };
    }

    if (keyRole === 'anon') {
      return {
        authenticated: true,
        projectRef: project.ref,
        apiRole: 'anon',
        userId: null,
        tenantId: null,
      };
    }

    throw new Error('Valid apikey or JWT token required');
  }

  onApplicationBootstrap() {
    const server = this.adapterHost.httpAdapter?.getHttpServer();
    if (!server) {
      this.logger.warn('HTTP server instance not available for Realtime WebSocket.');
      return;
    }

    this.wss = new WebSocketServer({
      server,
      path: '/realtime/v1',
    });

    this.logger.log('⚡ SkyNode Realtime WebSocket listening on path /realtime/v1');

    this.wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
      this.realtimeService.registerClient(ws);

      // Optional handshake query authentication: ?project=<ref>&apikey=<key>&token=<jwt>&tenant_id=<uuid>
      try {
        const parsedUrl = new URL(req.url || '/realtime/v1', 'http://localhost');
        const project = parsedUrl.searchParams.get('project');
        const apikey = parsedUrl.searchParams.get('apikey');
        const token = parsedUrl.searchParams.get('token');
        const tenantId = parsedUrl.searchParams.get('tenant_id');

        if (project && (apikey || token)) {
          const session = await this.authenticateConnection({ project, apikey, token, tenantId });
          this.realtimeService.setClientAuth(ws, session);
        }
      } catch (authErr: any) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: authErr?.message || 'WebSocket authentication failed',
          }),
        );
        ws.close(4001, 'Unauthorized');
        this.realtimeService.unregisterClient(ws);
        return;
      }

      const active = this.realtimeService.getClientSession(ws);
      ws.send(
        JSON.stringify({
          type: 'connected',
          authenticated: active?.authenticated ?? false,
          projectRef: active?.projectRef ?? null,
          tenantId: active?.tenantId ?? null,
          message: 'Connected to SkyNode Realtime Gateway v1',
          time: new Date().toISOString(),
        }),
      );

      ws.on('message', async (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'auth') {
            try {
              const session = await this.authenticateConnection({
                project: msg.project,
                apikey: msg.apikey,
                token: msg.token,
                tenantId: msg.tenant_id,
              });
              this.realtimeService.setClientAuth(ws, session);
              ws.send(
                JSON.stringify({
                  type: 'authenticated',
                  projectRef: session.projectRef,
                  apiRole: session.apiRole,
                  tenantId: session.tenantId,
                }),
              );
            } catch (err: any) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  message: err?.message || 'Realtime authentication failed',
                }),
              );
            }
          } else if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
            this.realtimeService.subscribe(ws, msg.channel);
          } else if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
            this.realtimeService.unsubscribe(ws, msg.channel);
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
          }
        } catch {
          ws.send(
            JSON.stringify({
              type: 'error',
              message: 'Invalid JSON message payload',
            }),
          );
        }
      });

      ws.on('close', () => {
        this.realtimeService.unregisterClient(ws);
      });

      ws.on('error', (err) => {
        this.logger.warn(`WebSocket error: ${err.message}`);
        this.realtimeService.unregisterClient(ws);
      });
    });
  }

  onApplicationShutdown() {
    if (this.wss) {
      this.wss.close();
      this.logger.log('SkyNode Realtime WebSocket shut down');
    }
  }
}
