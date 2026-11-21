import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Req,
  Res,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UpdateProfileDto,
  ChangePasswordDto,
} from './dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const COOKIE_NAME = 'skynode_session';
const IS_PROD = process.env.NODE_ENV === 'production';

function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'strict' : 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'strict' : 'lax',
    path: '/',
  });
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new platform user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto);
    return { data: user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    const result = await this.authService.login(dto, ip, userAgent);

    setSessionCookie(res, result.token, result.expiresAt);

    return { data: result.user };
  }

  @Get('github')
  @ApiOperation({ summary: 'Initiate GitHub OAuth login' })
  githubLogin(@Res() res: Response) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    const redirectUri = `${apiUrl}/api/v1/auth/github/callback`;

    if (!clientId) {
      this.logger.log('GITHUB_CLIENT_ID not configured, initiating dev simulation');
      return res.redirect(`${apiUrl}/api/v1/auth/github/callback?code=mock_github_dev`);
    }

    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email`;
    return res.redirect(githubAuthUrl);
  }

  @Get('github/callback')
  @ApiOperation({ summary: 'GitHub OAuth callback' })
  async githubCallback(
    @Query('code') code: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    try {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const userAgent = (req.headers['user-agent'] as string) || '';

      const result = await this.authService.handleGitHubCallback(code, ip, userAgent);

      setSessionCookie(res, result.token, result.expiresAt);

      return res.redirect(`${dashboardUrl}/projects`);
    } catch (err: any) {
      this.logger.error(`GitHub OAuth failed: ${err.message}`, err.stack);
      return res.redirect(
        `${dashboardUrl}/login?error=${encodeURIComponent(err.message || 'GitHub login failed')}`,
      );
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and destroy session' })
  @ApiCookieAuth()
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[COOKIE_NAME];
    await this.authService.logout(token);
    clearSessionCookie(res);
    return { data: { message: 'Logged out successfully' } };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Request password reset email' })
  @ApiResponse({ status: 200, description: 'Reset email triggered' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const result = await this.authService.forgotPassword(dto.email);
    return { data: result };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Reset password using token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const result = await this.authService.resetPassword(dto.token, dto.newPassword);
    return { data: result };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiCookieAuth()
  @ApiResponse({ status: 200, description: 'Current user' })
  async me(@CurrentUser() user: { userId: string }) {
    const profile = await this.authService.getProfile(user.userId);
    return { data: profile };
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Update user profile' })
  @ApiCookieAuth()
  async updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.authService.updateProfile(user.userId, dto);
    return { data: updated };
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Change password' })
  @ApiCookieAuth()
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.authService.changePassword(user.userId, dto);
    return { data: result };
  }

  @Get('sessions')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List active sessions' })
  @ApiCookieAuth()
  async listSessions(@CurrentUser() user: { userId: string }) {
    const sessions = await this.authService.listSessions(user.userId);
    return { data: sessions };
  }

  @Delete('sessions/:sessionId')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session' })
  @ApiCookieAuth()
  async revokeSession(
    @CurrentUser() user: { userId: string },
    @Param('sessionId') sessionId: string,
  ) {
    const result = await this.authService.revokeSession(user.userId, sessionId);
    return { data: result };
  }
}
