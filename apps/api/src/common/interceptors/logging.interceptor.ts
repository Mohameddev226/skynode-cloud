import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

/**
 * Logs incoming requests and outgoing responses with timing information.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const userAgent = request.get('user-agent') || '-';
    const requestId = (request.headers['x-request-id'] as string) || '-';
    const startTime = Date.now();

    this.logger.log(
      `→  ${method} ${url}  [${requestId}]  ip=${ip}  ua=${userAgent}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const duration = Date.now() - startTime;
          this.logger.log(
            `←  ${method} ${url}  ${response.statusCode}  ${duration}ms  [${requestId}]`,
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const status = error?.status || 500;
          this.logger.warn(
            `←  ${method} ${url}  ${status}  ${duration}ms  [${requestId}]  err=${error.message}`,
          );
        },
      }),
    );
  }
}
