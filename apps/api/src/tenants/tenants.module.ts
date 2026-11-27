import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { TenantAccessGuard } from './guards/tenant-access.guard';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { AppAuthModule } from '../app-auth/app-auth.module';
import { DatabaseStudioModule } from '../database-studio/database-studio.module';

@Module({
  imports: [AuthModule, ProjectsModule, AppAuthModule, DatabaseStudioModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantAccessGuard],
  exports: [TenantsService],
})
export class TenantsModule {}
