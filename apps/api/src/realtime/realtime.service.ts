import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';

export interface RealtimeEventPayload {
  project: string;
  tenantId?: string | null;
  schema: string;
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, any>;
  oldRecord?: Record<string, any> | null;
  timestamp?: string;
}

export interface RealtimeAuthSession {
  authenticated: boolean;
  projectRef: string | null;
  apiRole: 'anon' | 'authenticated' | 'service_role';
  userId: string | null;
  tenantId: string | null;
}

interface ClientSubscription extends RealtimeAuthSession {
  ws: WebSocket;
  channels: Set<string>;
}

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<WebSocket, ClientSubscription>();

  /**
   * Register a new client connection
   */
  registerClient(ws: WebSocket, initialAuth?: Partial<RealtimeAuthSession>) {
    this.clients.set(ws, {
      ws,
      channels: new Set<string>(),
      authenticated: initialAuth?.authenticated ?? false,
      projectRef: initialAuth?.projectRef ?? null,
      apiRole: initialAuth?.apiRole ?? 'anon',
      userId: initialAuth?.userId ?? null,
      tenantId: initialAuth?.tenantId ?? null,
    });
    this.logger.debug(`Realtime client connected (Total: ${this.clients.size})`);
  }

  setClientAuth(ws: WebSocket, auth: RealtimeAuthSession) {
    const sub = this.clients.get(ws);
    if (!sub) return;
    sub.authenticated = auth.authenticated;
    sub.projectRef = auth.projectRef;
    sub.apiRole = auth.apiRole;
    sub.userId = auth.userId;
    sub.tenantId = auth.tenantId;
    // Prune any channels that no longer match the newly bound project/tenant
    for (const ch of Array.from(sub.channels)) {
      if (!this.isChannelAuthorized(sub, ch)) {
        sub.channels.delete(ch);
      }
    }
  }

  getClientSession(ws: WebSocket): ClientSubscription | undefined {
    return this.clients.get(ws);
  }

  /**
   * Unregister a client connection
   */
  unregisterClient(ws: WebSocket) {
    this.clients.delete(ws);
    this.logger.debug(`Realtime client disconnected (Remaining: ${this.clients.size})`);
  }

  private parseChannel(channel: string): {
    project?: string;
    tenantId?: string;
    table?: string;
    isAll?: boolean;
  } | null {
    // Supported formats:
    // 1. project:<ref>:tenant:<tenantId>:table:<table>
    // 2. project:<ref>:tenant:<tenantId>:all
    // 3. project:<ref>:table:<table>
    // 4. project:<ref>:all
    const parts = channel.split(':');
    if (parts[0] !== 'project' || !parts[1]) return null;
    const project = parts[1];

    if (parts[2] === 'tenant' && parts[3]) {
      const tenantId = parts[3];
      if (parts[4] === 'table' && parts[5]) {
        return { project, tenantId, table: parts[5] };
      }
      if (parts[4] === 'all') {
        return { project, tenantId, isAll: true };
      }
      return null;
    }

    if (parts[2] === 'table' && parts[3]) {
      return { project, table: parts[3] };
    }
    if (parts[2] === 'all') {
      return { project, isAll: true };
    }
    return null;
  }

  isChannelAuthorized(sub: RealtimeAuthSession, channel: string): boolean {
    if (!sub.authenticated || !sub.projectRef) return false;
    const parsed = this.parseChannel(channel);
    if (!parsed) return false;

    // Cross-project subscription is strictly forbidden
    if (parsed.project !== sub.projectRef) return false;

    if (sub.apiRole === 'service_role') {
      return true;
    }

    // Tenant-specific channels must match the authenticated user's active tenant
    if (parsed.tenantId) {
      return sub.apiRole === 'authenticated' && sub.tenantId === parsed.tenantId;
    }

    return true;
  }

  /**
   * Subscribe a client to a project or tenant-partitioned channel
   */
  subscribe(ws: WebSocket, channel: string) {
    const sub = this.clients.get(ws);
    if (!sub) return;

    if (!this.isChannelAuthorized(sub, channel)) {
      this.logger.warn(
        `Denied unauthorized realtime subscription to "${channel}" (project=${sub.projectRef}, tenant=${sub.tenantId})`,
      );
      this.sendJson(ws, {
        type: 'error',
        channel,
        message: 'Unauthorized subscription: invalid project, tenant, or authentication state',
      });
      return;
    }

    sub.channels.add(channel);
    this.logger.debug(`Client subscribed to channel "${channel}"`);
    this.sendJson(ws, {
      type: 'subscribed',
      channel,
      tenantId: sub.tenantId,
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Unsubscribe a client from a channel
   */
  unsubscribe(ws: WebSocket, channel: string) {
    const sub = this.clients.get(ws);
    if (sub) {
      sub.channels.delete(channel);
      this.sendJson(ws, {
        type: 'unsubscribed',
        channel,
        status: 'ok',
      });
    }
  }

  private canDeliverToClient(sub: ClientSubscription, payload: RealtimeEventPayload): boolean {
    if (!sub.authenticated || sub.projectRef !== payload.project) {
      return false;
    }

    // Tenant isolation gate: never deliver tenant-scoped mutations to other tenants or anon clients
    if (payload.tenantId) {
      if (sub.apiRole === 'anon') return false;
      if (sub.apiRole === 'authenticated' && sub.tenantId !== payload.tenantId) {
        return false;
      }
    }

    const legacyTableChannel = `project:${payload.project}:table:${payload.table}`;
    const legacyAllChannel = `project:${payload.project}:all`;

    if (sub.channels.has(legacyTableChannel) || sub.channels.has(legacyAllChannel)) {
      return true;
    }

    if (payload.tenantId) {
      const tenantTableChannel = `project:${payload.project}:tenant:${payload.tenantId}:table:${payload.table}`;
      const tenantAllChannel = `project:${payload.project}:tenant:${payload.tenantId}:all`;
      if (sub.channels.has(tenantTableChannel) || sub.channels.has(tenantAllChannel)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Broadcast a database change event strictly to authorized, tenant-isolated subscribers
   */
  broadcast(payload: RealtimeEventPayload) {
    const channel = payload.tenantId
      ? `project:${payload.project}:tenant:${payload.tenantId}:table:${payload.table}`
      : `project:${payload.project}:table:${payload.table}`;

    const event = {
      type: 'event',
      channel,
      tenantId: payload.tenantId ?? null,
      schema: payload.schema || 'public',
      table: payload.table,
      eventType: payload.eventType,
      record: payload.record,
      oldRecord: payload.oldRecord ?? null,
      timestamp: payload.timestamp || new Date().toISOString(),
    };

    let deliveredCount = 0;
    for (const [ws, sub] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN && this.canDeliverToClient(sub, payload)) {
        this.sendJson(ws, event);
        deliveredCount++;
      }
    }

    this.logger.log(
      `Broadcast [${payload.eventType}] on ${payload.schema}.${payload.table} (project=${payload.project}, tenant=${payload.tenantId ?? 'global'}) -> ${deliveredCount} client(s)`,
    );
  }

  private sendJson(ws: WebSocket, data: any) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err: any) {
      this.logger.warn(`Failed to send message to websocket client: ${err.message}`);
    }
  }
}
