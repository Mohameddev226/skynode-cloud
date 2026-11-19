import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import { RealtimeService } from './realtime.service';

@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly realtimeService: RealtimeService,
  ) {}

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

    this.wss.on('connection', (ws: WebSocket, req) => {
      this.realtimeService.registerClient(ws);

      // Send initial welcome message
      ws.send(
        JSON.stringify({
          type: 'connected',
          message: 'Connected to SkyNode Realtime Gateway v1',
          time: new Date().toISOString(),
        }),
      );

      ws.on('message', (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'subscribe' && typeof msg.channel === 'string') {
            this.realtimeService.subscribe(ws, msg.channel);
          } else if (msg.type === 'unsubscribe' && typeof msg.channel === 'string') {
            this.realtimeService.unsubscribe(ws, msg.channel);
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
          }
        } catch (err: any) {
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
