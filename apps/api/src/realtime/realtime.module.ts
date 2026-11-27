import { Module, Global } from '@nestjs/common';
import { RealtimeService } from './realtime.service';
import { RealtimeGateway } from './realtime.gateway';
import { ProjectsModule } from '../projects/projects.module';
import { AppAuthModule } from '../app-auth/app-auth.module';
import { DatabaseStudioModule } from '../database-studio/database-studio.module';

@Global()
@Module({
  imports: [ProjectsModule, AppAuthModule, DatabaseStudioModule],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
