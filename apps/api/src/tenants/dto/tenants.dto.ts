import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsEmail,
  IsIn,
  IsArray,
  ValidateNested,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug may only contain lowercase letters, numbers, and hyphens',
  })
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  owner_user_id?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  plan?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateTenantStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'ARCHIVED'])
  status!: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export class PermissionRuleDto {
  @IsString()
  @MaxLength(100)
  resource!: string;

  @IsString()
  @MaxLength(50)
  action!: string;
}

export class CreateTenantRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Role name may only contain letters, numbers, underscores, and hyphens',
  })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionRuleDto)
  permissions?: PermissionRuleDto[];
}

export class AddTenantMemberDto {
  @IsOptional()
  @IsString()
  user_id?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  role_id?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsObject()
  custom_attributes?: Record<string, unknown>;
}

export class UpdateTenantMemberDto {
  @IsOptional()
  @IsString()
  role_id?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';

  @IsOptional()
  @IsObject()
  custom_attributes?: Record<string, unknown>;
}

export class CreateTenantInvitationDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  role_id?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsObject()
  custom_attributes?: Record<string, unknown>;
}

export class AcceptInvitationDto {
  @IsString()
  token!: string;
}

export class UpdateMultiTenancySettingsDto {
  @IsOptional()
  @IsBoolean()
  allow_self_serve_tenants?: boolean;

  @IsOptional()
  @IsBoolean()
  require_tenant_for_api?: boolean;
}
