import { Module } from '@nestjs/common';
import { StartupProvisionerService } from './startup-provisioner.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [PrismaModule, ProjectsModule],
  providers: [StartupProvisionerService],
})
export class BootstrapModule {}
