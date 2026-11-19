import { Module } from '@nestjs/common';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { ProjectsModule } from '../projects/projects.module';
import { DatabaseStudioModule } from '../database-studio/database-studio.module';

@Module({
  imports: [ProjectsModule, DatabaseStudioModule],
  controllers: [ApiGatewayController],
  providers: [ApiGatewayService],
  exports: [ApiGatewayService],
})
export class ApiGatewayModule {}
