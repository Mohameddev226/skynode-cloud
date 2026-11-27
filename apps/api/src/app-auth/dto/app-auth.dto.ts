import { IsEmail, IsString, MinLength, IsOptional, MaxLength } from 'class-validator';

export class AppRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;
}

export class AppLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tenant_id?: string;
}

export class AppRefreshDto {
  @IsString()
  refresh_token!: string;
}

export class AppSwitchTenantDto {
  @IsString()
  @MaxLength(128)
  tenant_id!: string;
}

export class AppUpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  full_name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class AppChangePasswordDto {
  @IsString()
  current_password!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password!: string;
}

export class AppResetPasswordRequestDto {
  @IsEmail()
  email!: string;
}

export class AppResetPasswordDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  new_password!: string;
}

export class AppVerifyEmailDto {
  @IsString()
  token!: string;
}
