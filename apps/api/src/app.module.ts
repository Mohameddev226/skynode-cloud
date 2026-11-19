import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { DatabaseStudioModule } from './database-studio/database-studio.module';
import { AppAuthModule } from './app-auth/app-auth.module';
import { StorageModule } from './storage/storage.module';
import { AuditModule } from './audit/audit.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ApiGatewayModule } from './api-gateway/api-gateway.module';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import minioConfig from './config/minio.config';

@Module({
  imports: [
    // ── Configuration ────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '../../.env.local',
        '../../.env',
      ],
      load: [appConfig, databaseConfig, redisConfig, minioConfig],
      cache: true,
      expandVariables: true,
    }),

    // ── Rate limiting ────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 second
        limit: 10,
      },
      {
        name: 'long',
        ttl: 60000,  // 1 minute
        limit: 100,
      },
    ]),

    // ── Infrastructure ───────────────────────────────────────
    PrismaModule,
    RedisModule,

    // ── Feature modules ──────────────────────────────────────
    MailModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    DatabaseStudioModule,
    AppAuthModule,
    StorageModule,
    AuditModule,
    BootstrapModule,
    RealtimeModule,
    ApiGatewayModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
