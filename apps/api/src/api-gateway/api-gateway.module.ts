import { Module } from '@nestjs/common';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { TenantApiGuard } from './guards/tenant-api.guard';
import { ProjectsModule } from '../projects/projects.module';
import { DatabaseStudioModule } from '../database-studio/database-studio.module';
import { AppAuthModule } from '../app-auth/app-auth.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ProjectsModule, DatabaseStudioModule, AppAuthModule, AuthModule],
  controllers: [ApiGatewayController],
  providers: [ApiGatewayService, TenantApiGuard],
  exports: [ApiGatewayService],
})
export class ApiGatewayModule {}
