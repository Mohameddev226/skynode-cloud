import { IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ example: 'Dugsihub', description: 'Display name of the project' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, {
    message: 'Name must start with a letter or number and contain only alphanumeric, spaces, hyphens, or underscores',
  })
  name: string;

  @ApiPropertyOptional({ example: 'Online learning platform backend' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: 'default', default: 'default' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  region?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional({ example: 'Dugsihub V2' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: 'Updated project description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateProjectApiKeyDto {
  @ApiProperty({ example: 'Mobile App Key' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'PUBLISHABLE', enum: ['PUBLISHABLE', 'SECRET'], default: 'PUBLISHABLE' })
  @IsOptional()
  @IsString()
  type?: 'PUBLISHABLE' | 'SECRET';
}
