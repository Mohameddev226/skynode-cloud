import { Module } from '@nestjs/common';
import { DatabaseStudioController } from './database-studio.controller';
import { DatabaseStudioService } from './database-studio.service';
import { ProjectConnectionManager } from './project-connection.manager';
import { ProjectsModule } from '../projects/projects.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ProjectsModule, AuthModule],
  controllers: [DatabaseStudioController],
  providers: [DatabaseStudioService, ProjectConnectionManager],
  exports: [DatabaseStudioService, ProjectConnectionManager],
})
export class DatabaseStudioModule {}
