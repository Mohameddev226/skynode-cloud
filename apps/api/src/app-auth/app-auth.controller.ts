import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppAuthService } from './app-auth.service';
import {
  AppRegisterDto,
  AppLoginDto,
  AppRefreshDto,
  AppUpdateProfileDto,
  AppChangePasswordDto,
} from './dto/app-auth.dto';
import { ProjectAppAuthGuard } from './guards/project-app-auth.guard';
import { AppCurrentUser } from './decorators/app-current-user.decorator';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('api/v1/projects/:ref/auth')
export class AppAuthController {
  constructor(private readonly appAuthService: AppAuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Param('ref') ref: string,
    @Body() dto: AppRegisterDto,
  ) {
    return this.appAuthService.register(ref, dto.email, dto.password, dto.full_name);
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Param('ref') ref: string, @Body() dto: AppLoginDto) {
    return this.appAuthService.login(ref, dto.email, dto.password);
  }

  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Param('ref') ref: string, @Body() dto: AppRefreshDto) {
    return this.appAuthService.refreshToken(ref, dto.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Param('ref') ref: string, @Body() dto: AppRefreshDto) {
    await this.appAuthService.logout(ref, dto.refresh_token);
  }

  @Get('user')
  @UseGuards(ProjectAppAuthGuard)
  async getUser(@Param('ref') ref: string, @AppCurrentUser() userId: string) {
    return this.appAuthService.getUser(ref, userId);
  }

  @Put('user')
  @UseGuards(ProjectAppAuthGuard)
  async updateUser(
    @Param('ref') ref: string,
    @AppCurrentUser() userId: string,
    @Body() dto: AppUpdateProfileDto,
  ) {
    return this.appAuthService.updateUser(ref, userId, {
      full_name: dto.full_name,
      email: dto.email,
    });
  }

  @Post('user/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ProjectAppAuthGuard)
  async changePassword(
    @Param('ref') ref: string,
    @AppCurrentUser() userId: string,
    @Body() dto: AppChangePasswordDto,
  ) {
    await this.appAuthService.changePassword(ref, userId, dto.current_password, dto.new_password);
  }

  // ── Admin endpoints (platform auth required) ──────────────────────────────

  @Get('admin/stats')
  @UseGuards(AuthGuard)
  async getStats(@Param('ref') ref: string) {
    return this.appAuthService.getStats(ref);
  }

  @Post('admin/users')
  @UseGuards(AuthGuard)
  async createUser(
    @Param('ref') ref: string,
    @Body() dto: AppRegisterDto,
  ) {
    return this.appAuthService.register(ref, dto.email, dto.password, dto.full_name);
  }

  @Get('admin/users')
  @UseGuards(AuthGuard)
  async listUsers(
    @Param('ref') ref: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.appAuthService.listUsers(ref, page, Math.min(limit, 100));
  }

  @Patch('admin/users/:userId/ban')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async banUser(
    @Param('ref') ref: string,
    @Param('userId') userId: string,
  ) {
    await this.appAuthService.banUser(ref, userId, true);
  }

  @Patch('admin/users/:userId/unban')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unbanUser(
    @Param('ref') ref: string,
    @Param('userId') userId: string,
  ) {
    await this.appAuthService.banUser(ref, userId, false);
  }

  @Delete('admin/users/:userId')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Param('ref') ref: string, @Param('userId') userId: string) {
    await this.appAuthService.deleteUser(ref, userId);
  }
}
