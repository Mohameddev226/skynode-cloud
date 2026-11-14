import { Injectable, Logger } from '@nestjs/common';

export interface AuditEntry {
  /** ID of the acting user or system component */
  actorId: string;
  /** 'user' | 'system' | 'api_key' */
  actorType: 'user' | 'system' | 'api_key';
  /** e.g. 'project.create', 'auth.login', 'backup.start' */
  action: string;
  /** e.g. 'Project', 'PlatformUser', 'Backup' */
  resourceType: string;
  /** ID of the affected resource */
  resourceId: string;
  /** Arbitrary JSON metadata (old/new values, params, etc.) */
  metadata?: Record<string, any>;
  /** Client IP */
  ipAddress?: string;
  /** Client user-agent string */
  userAgent?: string;
}

/**
 * AuditService — records immutable audit-log entries for every
 * security-relevant and data-mutating operation.
 *
 * Currently logs to stdout via NestJS Logger.
 * Phase 5 will persist entries via Prisma into the AuditLog table.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /**
   * Record an audit entry.
   * In production this will write to the AuditLog database table;
   * for now it serialises to structured log output.
   */
  async log(entry: AuditEntry): Promise<void> {
    const record = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(
      `AUDIT  ${entry.actorType}:${entry.actorId}  ${entry.action}  ` +
        `${entry.resourceType}:${entry.resourceId}`,
    );
    this.logger.debug(JSON.stringify(record));

    // TODO: Persist to database via Prisma
    // await this.prisma.auditLog.create({ data: record });
  }
}
