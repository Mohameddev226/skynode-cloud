import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';

export interface RealtimeEventPayload {
  project: string;
  schema: string;
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, any>;
  oldRecord?: Record<string, any> | null;
  timestamp?: string;
}

interface ClientSubscription {
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
  registerClient(ws: WebSocket) {
    this.clients.set(ws, {
      ws,
      channels: new Set<string>(),
    });
    this.logger.debug(`Realtime client connected (Total: ${this.clients.size})`);
  }

  /**
   * Unregister a client connection
   */
  unregisterClient(ws: WebSocket) {
    this.clients.delete(ws);
    this.logger.debug(`Realtime client disconnected (Remaining: ${this.clients.size})`);
  }

  /**
   * Subscribe a client to a channel (e.g. project:ref:table:students or project:ref:all)
   */
  subscribe(ws: WebSocket, channel: string) {
    const sub = this.clients.get(ws);
    if (sub) {
      sub.channels.add(channel);
      this.logger.debug(`Client subscribed to channel "${channel}"`);
      this.sendJson(ws, {
        type: 'subscribed',
        channel,
        status: 'ok',
        timestamp: new Date().toISOString(),
      });
    }
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

  /**
   * Broadcast a database change event to all matching subscribers
   */
  broadcast(payload: RealtimeEventPayload) {
    const event = {
      type: 'event',
      channel: `project:${payload.project}:table:${payload.table}`,
      schema: payload.schema || 'public',
      table: payload.table,
      eventType: payload.eventType,
      record: payload.record,
      oldRecord: payload.oldRecord ?? null,
      timestamp: payload.timestamp || new Date().toISOString(),
    };

    const targetChannel1 = `project:${payload.project}:table:${payload.table}`;
    const targetChannel2 = `project:${payload.project}:all`;

    let deliveredCount = 0;
    for (const [ws, sub] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (sub.channels.has(targetChannel1) || sub.channels.has(targetChannel2)) {
          this.sendJson(ws, event);
          deliveredCount++;
        }
      }
    }

    this.logger.log(
      `Broadcast [${payload.eventType}] on ${payload.schema}.${payload.table} in project ${payload.project} (Delivered to ${deliveredCount} clients)`,
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
