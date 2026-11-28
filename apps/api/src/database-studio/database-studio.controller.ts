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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { DatabaseStudioService } from './database-studio.service';
import { DatabaseAdvancedService } from './database-advanced.service';
import { ProjectsService } from '../projects/projects.service';
import {
  CreateTableDto,
  SqlQueryDto,
  TableQueryPaginationDto,
  CreateSchemaDto,
  RenameTableDto,
  AlterColumnDto,
  CreateIndexDto,
  CreateForeignKeyDto,
  CreateMigrationDto,
  ToggleExtensionDto,
  MaintenanceDto,
} from './dto/database-studio.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Database Studio')
@Controller('projects/:identifier/database')
@UseGuards(AuthGuard)
@ApiCookieAuth()
export class DatabaseStudioController {
  constructor(
    private readonly studioService: DatabaseStudioService,
    private readonly advancedService: DatabaseAdvancedService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Helper to resolve project credentials for current user.
   */
  private async getCredentials(identifier: string, userId: string) {
    const dbConfig = await this.projectsService.getDatabaseConfig(identifier, userId);
    return {
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      forceFallback: dbConfig.forceFallback,
    };
  }

  @Get('tables')
  @ApiOperation({ summary: 'List all tables in project database' })
  async listTables(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const tables = await this.studioService.getTables(creds);
    return { data: tables };
  }

  @Get('tables/:tableName')
  @ApiOperation({ summary: 'Get schema and column definitions for a table' })
  async getTableSchema(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.studioService.getTableSchema(creds, schema, tableName);
    return { data: result };
  }

  @Post('tables')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new table' })
  async createTable(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: CreateTableDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.createTable(creds, dto);
    return { data: { message: `Table ${dto.name} created successfully` } };
  }

  @Delete('tables/:tableName')
  @ApiOperation({ summary: 'Drop a table' })
  async dropTable(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.dropTable(creds, schema, tableName);
    return { data: { message: `Table ${tableName} dropped` } };
  }

  @Get('tables/:tableName/records')
  @ApiOperation({ summary: 'Get paginated records from a table' })
  async getRecords(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Query() pagination: TableQueryPaginationDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const targetSchema = pagination.schema || schema || 'public';
    const result = await this.studioService.getTableRecords(creds, targetSchema, tableName, pagination);
    return { data: result };
  }

  @Post('tables/:tableName/records')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Insert a record into a table' })
  async insertRecord(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() recordData: Record<string, any>,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const created = await this.studioService.insertRecord(creds, schema, tableName, recordData);
    return { data: created };
  }

  @Patch('tables/:tableName/records/:id')
  @ApiOperation({ summary: 'Update a record by ID or primary key' })
  async updateRecord(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
    @Body() recordData: Record<string, any>,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const updated = await this.studioService.updateRecord(creds, schema, tableName, pk, id, recordData);
    return { data: updated };
  }

  @Delete('tables/:tableName/records/:id')
  @ApiOperation({ summary: 'Delete a record by ID or primary key' })
  async deleteRecord(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.deleteRecord(creds, schema, tableName, pk, id);
    return { data: { message: 'Record deleted' } };
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute raw SQL query against project database (SQL Editor)' })
  async executeQuery(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: SqlQueryDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.studioService.executeQuery(creds, dto.sql);
    return { data: result };
  }

  @Post('tables/:tableName/columns')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a column to an existing table' })
  async addColumn(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: { name: string; type: string; nullable?: boolean; defaultValue?: string },
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.addColumn(creds, schema, tableName, dto);
    return { data: { message: `Column ${dto.name} added to ${tableName}` } };
  }

  @Delete('tables/:tableName/columns/:columnName')
  @ApiOperation({ summary: 'Drop a column from a table' })
  async dropColumn(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('columnName') columnName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.dropColumn(creds, schema, tableName, columnName);
    return { data: { message: `Column ${columnName} dropped from ${tableName}` } };
  }

  @Get('tables/:tableName/policies')
  @ApiOperation({ summary: 'List RLS policies for a table' })
  async listPolicies(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const policies = await this.studioService.listPolicies(creds, schema, tableName);
    return { data: policies };
  }

  @Post('tables/:tableName/policies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an RLS policy on a table' })
  async createPolicy(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: { name: string; command: string; using?: string; withCheck?: string },
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.createPolicy(creds, schema, tableName, dto);
    return { data: { message: `Policy ${dto.name} created` } };
  }

  @Delete('tables/:tableName/policies/:policyName')
  @ApiOperation({ summary: 'Drop an RLS policy' })
  async dropPolicy(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('policyName') policyName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.dropPolicy(creds, schema, tableName, policyName);
    return { data: { message: `Policy ${policyName} dropped` } };
  }

  @Post('tables/:tableName/rls')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable or disable RLS on a table' })
  async setRls(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: { enabled: boolean; force?: boolean },
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.studioService.setRls(creds, schema, tableName, dto.enabled, dto.force ?? false);
    return { data: { message: `RLS ${dto.enabled ? 'enabled' : 'disabled'} on ${tableName}` } };
  }

  @Post('tables/:tableName/rls/template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a universal multi-tenant RLS policy template to a table' })
  async applyRlsTemplate(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body()
    dto: {
      template: 'tenant_isolation' | 'tenant_rbac' | 'public_read_tenant_write' | 'global_read';
      tenantColumn?: string;
      resourceName?: string;
    },
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.studioService.applyTenantRlsTemplate(creds, schema, tableName, dto);
    return { data: result };
  }

  // ── Phase 5: Schemas, Table/Column Evolution, Indexes, FKs, Migrations, Extensions & Performance ──

  @Get('schemas')
  @ApiOperation({ summary: 'List database schemas and table counts' })
  async listSchemas(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const schemas = await this.advancedService.listSchemas(creds);
    return { data: schemas };
  }

  @Post('schemas')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a custom database schema' })
  async createSchema(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: CreateSchemaDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const created = await this.advancedService.createSchema(creds, dto.name);
    return { data: created };
  }

  @Patch('tables/:tableName')
  @ApiOperation({ summary: 'Rename an existing table' })
  async renameTable(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: RenameTableDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.advancedService.renameTable(creds, schema, tableName, dto.newName);
    return { data: result };
  }

  @Patch('tables/:tableName/columns/:columnName')
  @ApiOperation({ summary: 'Rename or alter column type, nullability, or default value' })
  async alterColumn(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('columnName') columnName: string,
    @Query('schema') schema = 'public',
    @Body() dto: AlterColumnDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.advancedService.alterColumn(creds, schema, tableName, columnName, dto);
    return { data: result };
  }

  @Get('indexes')
  @ApiOperation({ summary: 'List all database indexes across schemas/tables' })
  async listAllIndexes(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Query('schema') schema?: string,
    @Query('table') table?: string,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const indexes = await this.advancedService.listIndexes(creds, schema, table);
    return { data: indexes };
  }

  @Get('tables/:tableName/indexes')
  @ApiOperation({ summary: 'List indexes for a specific table' })
  async listTableIndexes(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const indexes = await this.advancedService.listIndexes(creds, schema, tableName);
    return { data: indexes };
  }

  @Post('tables/:tableName/indexes')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an index on a table' })
  async createIndex(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: CreateIndexDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const created = await this.advancedService.createIndex(creds, schema, tableName, dto);
    return { data: created };
  }

  @Delete('indexes/:indexName')
  @ApiOperation({ summary: 'Drop an index' })
  async dropIndex(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('indexName') indexName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.advancedService.dropIndex(creds, schema, indexName);
    return { data: { message: `Index ${indexName} dropped` } };
  }

  @Get('foreign-keys')
  @ApiOperation({ summary: 'List all foreign key relationships across tables' })
  async listAllForeignKeys(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Query('schema') schema?: string,
    @Query('table') table?: string,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const fks = await this.advancedService.listForeignKeys(creds, schema, table);
    return { data: fks };
  }

  @Get('tables/:tableName/foreign-keys')
  @ApiOperation({ summary: 'List foreign keys for a table' })
  async listTableForeignKeys(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const fks = await this.advancedService.listForeignKeys(creds, schema, tableName);
    return { data: fks };
  }

  @Post('tables/:tableName/foreign-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a foreign key relationship to a table' })
  async createForeignKey(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() dto: CreateForeignKeyDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const created = await this.advancedService.createForeignKey(creds, schema, tableName, dto);
    return { data: created };
  }

  @Delete('tables/:tableName/foreign-keys/:constraintName')
  @ApiOperation({ summary: 'Drop a foreign key constraint' })
  async dropForeignKey(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('constraintName') constraintName: string,
    @Query('schema') schema = 'public',
  ) {
    const creds = await this.getCredentials(identifier, userId);
    await this.advancedService.dropForeignKey(creds, schema, tableName, constraintName);
    return { data: { message: `Foreign key ${constraintName} dropped` } };
  }

  @Get('migrations')
  @ApiOperation({ summary: 'List database migrations' })
  async listMigrations(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const migrations = await this.advancedService.listMigrations(creds);
    return { data: migrations };
  }

  @Post('migrations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and optionally apply a database migration' })
  async createMigration(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: CreateMigrationDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const migration = await this.advancedService.createMigration(creds, dto);
    return { data: migration };
  }

  @Post('migrations/:migrationId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a pending or rolled-back migration' })
  async applyMigration(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('migrationId') migrationId: string,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const migration = await this.advancedService.applyMigration(creds, migrationId);
    return { data: migration };
  }

  @Post('migrations/:migrationId/rollback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rollback an applied migration using its down_sql' })
  async rollbackMigration(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Param('migrationId') migrationId: string,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const migration = await this.advancedService.rollbackMigration(creds, migrationId);
    return { data: migration };
  }

  @Get('extensions')
  @ApiOperation({ summary: 'List available and installed PostgreSQL extensions' })
  async listExtensions(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const extensions = await this.advancedService.listExtensions(creds);
    return { data: extensions };
  }

  @Post('extensions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable or disable a PostgreSQL extension' })
  async toggleExtension(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: ToggleExtensionDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.advancedService.toggleExtension(creds, dto.name, dto.enabled);
    return { data: result };
  }

  @Get('functions')
  @ApiOperation({ summary: 'List database functions' })
  async listFunctions(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const fns = await this.advancedService.listFunctions(creds);
    return { data: fns };
  }

  @Get('triggers')
  @ApiOperation({ summary: 'List database triggers' })
  async listTriggers(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const triggers = await this.advancedService.listTriggers(creds);
    return { data: triggers };
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get table scan/tuple statistics and slow query performance' })
  async getPerformance(@CurrentUser('userId') userId: string, @Param('identifier') identifier: string) {
    const creds = await this.getCredentials(identifier, userId);
    const stats = await this.advancedService.getPerformanceStats(creds);
    return { data: stats };
  }

  @Post('maintenance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run VACUUM or ANALYZE on a table or database' })
  async runMaintenance(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: MaintenanceDto,
  ) {
    const creds = await this.getCredentials(identifier, userId);
    const result = await this.advancedService.runMaintenance(creds, dto);
    return { data: result };
  }
}
