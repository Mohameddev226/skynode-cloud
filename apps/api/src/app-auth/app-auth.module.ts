import { Module } from '@nestjs/common';
import { AppAuthService } from './app-auth.service';
import { AppAuthController } from './app-auth.controller';
import { ProjectAppAuthGuard } from './guards/project-app-auth.guard';
import { DatabaseStudioModule } from '../database-studio/database-studio.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [DatabaseStudioModule, AuthModule, PrismaModule],
  controllers: [AppAuthController],
  providers: [AppAuthService, ProjectAppAuthGuard],
  exports: [AppAuthService],
})
export class AppAuthModule {}
