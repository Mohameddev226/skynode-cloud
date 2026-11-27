import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { TenantsService } from './tenants.service';
import { TenantAccessGuard } from './guards/tenant-access.guard';
import type { TenantCallerContext } from './guards/tenant-access.guard';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateTenantStatusDto,
  CreateTenantRoleDto,
  AddTenantMemberDto,
  UpdateTenantMemberDto,
  CreateTenantInvitationDto,
  AcceptInvitationDto,
  UpdateMultiTenancySettingsDto,
} from './dto/tenants.dto';

@ApiTags('Universal Tenants')
@ApiBearerAuth()
@Controller('projects/:identifier/tenants')
@UseGuards(TenantAccessGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  private getCaller(req: Request & { tenantCaller?: TenantCallerContext }): TenantCallerContext {
    return req.tenantCaller!;
  }

  // ── Project Multi-Tenancy Settings ───────────────────────────────────────

  @Get('settings')
  @ApiOperation({ summary: 'Get project multi-tenancy configuration settings' })
  getSettings(@Param('identifier') identifier: string) {
    return this.tenantsService.getSettings(identifier);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update project multi-tenancy settings (service_role/owner)' })
  updateSettings(
    @Param('identifier') identifier: string,
    @Req() req: Request,
    @Body() dto: UpdateMultiTenancySettingsDto,
  ) {
    return this.tenantsService.updateSettings(identifier, this.getCaller(req), dto);
  }

  // ── Project-Wide Roles & Invitations Acceptance ──────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'List project-wide default/custom roles' })
  listGlobalRoles(@Param('identifier') identifier: string, @Req() req: Request) {
    return this.tenantsService.listRoles(identifier, this.getCaller(req));
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom project-wide role and permissions' })
  createGlobalRole(
    @Param('identifier') identifier: string,
    @Req() req: Request,
    @Body() dto: CreateTenantRoleDto,
  ) {
    return this.tenantsService.createRole(identifier, this.getCaller(req), dto);
  }

  @Delete('roles/:roleId')
  @ApiOperation({ summary: 'Delete a custom project-wide role' })
  deleteGlobalRole(
    @Param('identifier') identifier: string,
    @Param('roleId') roleId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.deleteRole(identifier, this.getCaller(req), roleId);
  }

  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a tenant invitation using token' })
  acceptInvitation(
    @Param('identifier') identifier: string,
    @Req() req: Request,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.tenantsService.acceptInvitation(identifier, this.getCaller(req), dto.token);
  }

  // ── Tenant CRUD ──────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new tenant (company/school/org)' })
  createTenant(
    @Param('identifier') identifier: string,
    @Req() req: Request,
    @Body() dto: CreateTenantDto,
  ) {
    return this.tenantsService.createTenant(identifier, this.getCaller(req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tenants (all for admin/service_role, memberships for users)' })
  listTenants(
    @Param('identifier') identifier: string,
    @Req() req: Request,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.tenantsService.listTenants(identifier, this.getCaller(req), {
      page,
      limit,
      status,
      search,
    });
  }

  @Get(':tenantId')
  @ApiOperation({ summary: 'Get tenant details' })
  getTenant(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.getTenant(identifier, this.getCaller(req), tenantId);
  }

  @Patch(':tenantId')
  @ApiOperation({ summary: 'Update tenant details and metadata' })
  updateTenant(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.tenantsService.updateTenant(identifier, this.getCaller(req), tenantId, dto);
  }

  @Patch(':tenantId/status')
  @ApiOperation({ summary: 'Suspend, activate, or archive a tenant (admin/service_role)' })
  updateTenantStatus(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
    @Body() dto: UpdateTenantStatusDto,
  ) {
    return this.tenantsService.updateTenantStatus(
      identifier,
      this.getCaller(req),
      tenantId,
      dto.status,
    );
  }

  @Delete(':tenantId')
  @ApiOperation({ summary: 'Delete a tenant and its memberships' })
  deleteTenant(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.deleteTenant(identifier, this.getCaller(req), tenantId);
  }

  // ── Tenant-Scoped Roles ──────────────────────────────────────────────────

  @Get(':tenantId/roles')
  @ApiOperation({ summary: 'List global and tenant-specific roles' })
  listTenantRoles(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.listRoles(identifier, this.getCaller(req), tenantId);
  }

  @Post(':tenantId/roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom role scoped to a specific tenant' })
  createTenantRole(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
    @Body() dto: CreateTenantRoleDto,
  ) {
    return this.tenantsService.createRole(identifier, this.getCaller(req), dto, tenantId);
  }

  @Delete(':tenantId/roles/:roleId')
  @ApiOperation({ summary: 'Delete a custom role scoped to a tenant' })
  deleteTenantRole(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Param('roleId') roleId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.deleteRole(identifier, this.getCaller(req), roleId, tenantId);
  }

  // ── Tenant Memberships ───────────────────────────────────────────────────

  @Get(':tenantId/members')
  @ApiOperation({ summary: 'List members of a tenant' })
  listMembers(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.listMembers(identifier, this.getCaller(req), tenantId);
  }

  @Post(':tenantId/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an existing user to a tenant with role and custom attributes' })
  addMember(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
    @Body() dto: AddTenantMemberDto,
  ) {
    return this.tenantsService.addMember(identifier, this.getCaller(req), tenantId, dto);
  }

  @Patch(':tenantId/members/:userId')
  @ApiOperation({ summary: 'Update a tenant member role, status, or custom attributes' })
  updateMember(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Req() req: Request,
    @Body() dto: UpdateTenantMemberDto,
  ) {
    return this.tenantsService.updateMember(
      identifier,
      this.getCaller(req),
      tenantId,
      userId,
      dto,
    );
  }

  @Delete(':tenantId/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a tenant' })
  removeMember(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.removeMember(identifier, this.getCaller(req), tenantId, userId);
  }

  // ── Tenant Invitations ───────────────────────────────────────────────────

  @Get(':tenantId/invitations')
  @ApiOperation({ summary: 'List invitations for a tenant' })
  listInvitations(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
  ) {
    return this.tenantsService.listInvitations(identifier, this.getCaller(req), tenantId);
  }

  @Post(':tenantId/invitations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Invite a user by email to join a tenant' })
  createInvitation(
    @Param('identifier') identifier: string,
    @Param('tenantId') tenantId: string,
    @Req() req: Request,
    @Body() dto: CreateTenantInvitationDto,
  ) {
    return this.tenantsService.createInvitation(identifier, this.getCaller(req), tenantId, dto);
  }
}
