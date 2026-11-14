import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // ── Validate required environment variables ──────────────────
  const required = ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Set them in .env or your deployment config before starting.');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // ── Security ────────────────────────────────────────────────
  app.use(helmet());
  app.use(cookieParser());

  // ── CORS ────────────────────────────────────────────────────
  const corsOrigins = configService.get<string>('CORS_ORIGINS', 'http://localhost:3000');
  app.enableCors({
    origin: corsOrigins.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'],
  });

  // ── Global prefix ──────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Global pipes / filters / interceptors ──────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ── Swagger ─────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SkyNode Cloud API')
    .setDescription('Control-plane REST API for the SkyNode Cloud platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addCookieAuth('session')
    .addServer('/api/v1', 'v1')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  // ── Graceful shutdown ───────────────────────────────────────
  app.enableShutdownHooks();

  // ── Start ───────────────────────────────────────────────────
  const port = configService.get<number>('APP_PORT', 4000);
  await app.listen(port);
  logger.log(`🚀  SkyNode API listening on http://0.0.0.0:${port}`);
  logger.log(`📄  Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
