import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisModule');
        const redisUrl = process.env.REDIS_URL;

        const backoffStrategy = (times: number) => Math.min(times * 500, 10000);

        let client: Redis;
        if (redisUrl) {
          const isUpstash = redisUrl.includes('upstash.io');
          const finalUrl =
            isUpstash && redisUrl.startsWith('redis://')
              ? redisUrl.replace('redis://', 'rediss://')
              : redisUrl;

          client = new Redis(finalUrl, {
            keyPrefix: 'skynode:',
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 5000,
            tls: finalUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
            retryStrategy: backoffStrategy,
          });
        } else {
          client = new Redis({
            host: config.get<string>('redis.host', 'localhost'),
            port: config.get<number>('redis.port', 6379),
            password: config.get<string>('redis.password') || undefined,
            db: config.get<number>('redis.db', 0),
            keyPrefix: config.get<string>('redis.keyPrefix', 'skynode:'),
            tls: config.get('redis.tls'),
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            connectTimeout: 5000,
            retryStrategy: backoffStrategy,
          });
        }

        let lastErrLog = 0;
        client.on('connect', () => logger.log('Redis connected'));
        client.on('error', (err) => {
          const now = Date.now();
          if (now - lastErrLog > 30000) {
            logger.warn(`Redis connection notice (${err.message}); DB session fallback active.`);
            lastErrLog = now;
          }
        });

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
