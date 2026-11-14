import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  name: process.env.APP_NAME || 'SkyNode Cloud',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.APP_PORT || '4000', 10),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim()),
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || '86400000', 10), // 24h
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  jwtSecret: process.env.JWT_SECRET || 'change-me-jwt-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  apiRateLimit: parseInt(process.env.API_RATE_LIMIT || '100', 10),
  logLevel: process.env.LOG_LEVEL || 'debug',
}));
