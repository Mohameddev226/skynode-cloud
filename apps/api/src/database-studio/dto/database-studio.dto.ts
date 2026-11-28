import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsIn,
  Matches,
  ArrayMinSize,
} from 'class-validator';
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
  @ApiPropertyOptional({ default: 'public' })
  @IsOptional()
  @IsString()
  schema?: string = 'public';

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

export class CreateSchemaDto {
  @ApiProperty({ example: 'analytics' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Schema name must contain only letters, numbers, and underscores' })
  name!: string;
}

export class RenameTableDto {
  @ApiProperty({ example: 'fuel_orders' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Table name must contain only letters, numbers, and underscores' })
  newName!: string;
}

export class AlterColumnDto {
  @ApiPropertyOptional({ example: 'unit_price' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Column name must contain only letters, numbers, and underscores' })
  newName?: string;

  @ApiPropertyOptional({ example: 'numeric(12,2)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  nullable?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  defaultValue?: string | null;
}

export class CreateIndexDto {
  @ApiProperty({ example: 'idx_fuel_sales_tenant_id' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Index name must contain only letters, numbers, and underscores' })
  name!: string;

  @ApiProperty({ example: ['tenant_id'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  columns!: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  unique?: boolean;

  @ApiPropertyOptional({ enum: ['btree', 'hash', 'gin', 'gist'], default: 'btree' })
  @IsOptional()
  @IsIn(['btree', 'hash', 'gin', 'gist'])
  method?: 'btree' | 'hash' | 'gin' | 'gist';
}

export class CreateForeignKeyDto {
  @ApiPropertyOptional({ example: 'fk_fuel_sales_station_id' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Constraint name must contain only letters, numbers, and underscores' })
  name?: string;

  @ApiProperty({ example: 'station_id' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/)
  column!: string;

  @ApiPropertyOptional({ default: 'public' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/)
  referencedSchema?: string;

  @ApiProperty({ example: 'stations' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/)
  referencedTable!: string;

  @ApiProperty({ example: 'id' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/)
  referencedColumn!: string;

  @ApiPropertyOptional({ enum: ['NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'] })
  @IsOptional()
  @IsIn(['NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'])
  onDelete?: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';

  @ApiPropertyOptional({ enum: ['NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'] })
  @IsOptional()
  @IsIn(['NO ACTION', 'CASCADE', 'RESTRICT', 'SET NULL', 'SET DEFAULT'])
  onUpdate?: 'NO ACTION' | 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'SET DEFAULT';
}

export class CreateMigrationDto {
  @ApiProperty({ example: 'add_station_branches_table' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'CREATE TABLE public.branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);' })
  @IsString()
  @IsNotEmpty()
  upSql!: string;

  @ApiPropertyOptional({ example: 'DROP TABLE IF EXISTS public.branches;' })
  @IsOptional()
  @IsString()
  downSql?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  applyNow?: boolean;
}

export class ToggleExtensionDto {
  @ApiProperty({ example: 'pg_trgm' })
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  name!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled!: boolean;
}

export class MaintenanceDto {
  @ApiProperty({ enum: ['vacuum', 'analyze'] })
  @IsIn(['vacuum', 'analyze'])
  action!: 'vacuum' | 'analyze';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  schema?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  table?: string;
}
