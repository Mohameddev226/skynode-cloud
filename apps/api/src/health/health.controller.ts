import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

interface ServiceStatus {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    minio: ServiceStatus;
  };
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startTime = Date.now();

  constructor(private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({ summary: 'System health check' })
  @ApiOkResponse({ description: 'Health status of all services' })
  async check(): Promise<HealthResponse> {
    const [database, redis, minio] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMinio(),
    ]);

    const allUp = [database, redis, minio].every((s) => s.status === 'up');
    const allDown = [database, redis, minio].every((s) => s.status === 'down');

    let status: HealthResponse['status'];
    if (allUp) status = 'healthy';
    else if (allDown) status = 'unhealthy';
    else status = 'degraded';

    return {
      status,
      version: process.env.npm_package_version || '0.1.0',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      services: { database, redis, minio },
    };
  }

  // ── Service probes ──────────────────────────────────────────

  private async checkDatabase(): Promise<ServiceStatus> {
    try {
      const { Client } = await import('pg');
      const client = new Client({
        connectionString: this.config.get<string>('DATABASE_URL'),
        connectionTimeoutMillis: 3000,
      });
      const start = Date.now();
      await client.connect();
      await client.query('SELECT 1');
      const latencyMs = Date.now() - start;
      await client.end();
      return { status: 'up', latencyMs };
    } catch (error: any) {
      this.logger.warn(`Database health check failed: ${error.message}`);
      return { status: 'down', error: error.message };
    }
  }

  private async checkRedis(): Promise<ServiceStatus> {
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis({
        host: this.config.get<string>('REDIS_HOST', 'localhost'),
        port: this.config.get<number>('REDIS_PORT', 6379),
        password: this.config.get<string>('REDIS_PASSWORD') || undefined,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      const start = Date.now();
      await redis.connect();
      await redis.ping();
      const latencyMs = Date.now() - start;
      await redis.quit();
      return { status: 'up', latencyMs };
    } catch (error: any) {
      this.logger.warn(`Redis health check failed: ${error.message}`);
      return { status: 'down', error: error.message };
    }
  }

  private async checkMinio(): Promise<ServiceStatus> {
    try {
      // Lightweight TCP check to MinIO endpoint
      const net = await import('net');
      const host = this.config.get<string>('MINIO_ENDPOINT', 'localhost');
      const port = this.config.get<number>('MINIO_PORT', 9000);

      const latencyMs = await new Promise<number>((resolve, reject) => {
        const start = Date.now();
        const socket = net.createConnection({ host, port, timeout: 3000 }, () => {
          resolve(Date.now() - start);
          socket.destroy();
        });
        socket.on('error', reject);
        socket.on('timeout', () => {
          socket.destroy();
          reject(new Error('Connection timed out'));
        });
      });

      return { status: 'up', latencyMs };
    } catch (error: any) {
      this.logger.warn(`MinIO health check failed: ${error.message}`);
      return { status: 'down', error: error.message };
    }
  }
}
