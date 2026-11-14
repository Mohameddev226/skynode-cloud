import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, IsArray, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ColumnDefinitionDto {
  @ApiProperty({ example: 'id' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'uuid', description: 'Postgres data type: text, integer, boolean, timestamp, uuid, jsonb, etc.' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isPrimary?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  isNullable?: boolean;

  @ApiPropertyOptional({ example: 'gen_random_uuid()' })
  @IsOptional()
  @IsString()
  defaultValue?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  isUnique?: boolean;
}

export class CreateTableDto {
  @ApiProperty({ example: 'products' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'public', default: 'public' })
  @IsOptional()
  @IsString()
  schema?: string;

  @ApiProperty({ type: [ColumnDefinitionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ColumnDefinitionDto)
  columns: ColumnDefinitionDto[];
}

export class SqlQueryDto {
  @ApiProperty({ example: 'SELECT * FROM users LIMIT 10;' })
  @IsString()
  @IsNotEmpty()
  sql: string;
}

export class TableQueryPaginationDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiPropertyOptional({ example: 'created_at' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ example: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}
