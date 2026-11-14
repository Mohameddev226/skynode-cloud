import { IsString, IsBoolean, IsOptional, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateBucketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(63)
  @Matches(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, {
    message: 'Bucket name must start and end with lowercase letter or number, and contain only lowercase letters, numbers, dots, and hyphens',
  })
  name!: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}

export class UploadUrlRequestDto {
  @IsString()
  @MinLength(1)
  fileName!: string;

  @IsOptional()
  @IsString()
  contentType?: string;
}

export class DeleteFileDto {
  @IsString()
  @MinLength(1)
  key!: string;
}
