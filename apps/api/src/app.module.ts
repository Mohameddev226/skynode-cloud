import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { AuditModule } from './audit/audit.module';
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

    // ── Feature modules ──────────────────────────────────────
    HealthModule,
    AuthModule,
    ProjectsModule,
    AuditModule,

    // TODO: Phase 5 — Add BillingModule
    // TODO: Phase 6 — Add StorageModule (MinIO)
    // TODO: Phase 7 — Add NotificationsModule (email / webhooks)
    // TODO: Phase 8 — Add MetricsModule (Prometheus / Grafana)
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
