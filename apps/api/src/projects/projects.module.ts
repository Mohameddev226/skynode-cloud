import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { DatabaseProvisionerService } from './provisioning/database-provisioner.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, DatabaseProvisionerService],
  exports: [ProjectsService, DatabaseProvisionerService],
})
export class ProjectsModule {}
