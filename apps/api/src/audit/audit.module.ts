import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * AuditModule — provides structured audit logging for all control-plane actions.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
