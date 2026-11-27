import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiGatewayService } from './api-gateway.service';
import { TenantApiGuard, ResolvedApiContext } from './guards/tenant-api.guard';

@ApiTags('Auto REST API')
@ApiBearerAuth()
@Controller('projects/:identifier/rest/v1')
@UseGuards(TenantApiGuard)
export class ApiGatewayController {
  constructor(private readonly apiGatewayService: ApiGatewayService) {}

  private getApiContext(req: Request & { apiContext?: ResolvedApiContext }): ResolvedApiContext {
    return req.apiContext!;
  }

  @Get(':tableName')
  @ApiOperation({ summary: 'Query table records with PostgREST-style filters and RLS' })
  @ApiHeader({ name: 'apikey', required: false, description: 'Anon or Service Role key' })
  @ApiHeader({ name: 'X-Tenant-ID', required: false, description: 'Active Tenant UUID or slug' })
  async getRows(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Query() queryParams: Record<string, any>,
  ) {
    return this.apiGatewayService.getRows(
      this.getApiContext(req),
      schema,
      tableName,
      queryParams,
    );
  }

  @Get(':tableName/:id')
  @ApiOperation({ summary: 'Get single record by ID or primary key with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async getRowById(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
  ) {
    const record = await this.apiGatewayService.getRowById(
      this.getApiContext(req),
      schema,
      tableName,
      id,
      pk,
    );
    return { data: record };
  }

  @Post(':tableName')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Insert single or multiple records into a table with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async insertRow(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() payload: Record<string, any> | Record<string, any>[],
  ) {
    const inserted = await this.apiGatewayService.insertRow(
      this.getApiContext(req),
      schema,
      tableName,
      payload,
    );
    return { data: inserted };
  }

  @Patch(':tableName/:id')
  @ApiOperation({ summary: 'Update a record by ID or primary key with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async updateRow(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
    @Body() data: Record<string, any>,
  ) {
    const updated = await this.apiGatewayService.updateRow(
      this.getApiContext(req),
      schema,
      tableName,
      id,
      pk,
      data,
    );
    return { data: updated };
  }

  @Patch(':tableName')
  @ApiOperation({ summary: 'Update matching records using PostgREST filters with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async updateRowsByFilter(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Query() queryParams: Record<string, any>,
    @Body() data: Record<string, any>,
  ) {
    const updated = await this.apiGatewayService.updateRowsByFilter(
      this.getApiContext(req),
      schema,
      tableName,
      queryParams,
      data,
    );
    return { data: updated };
  }

  @Delete(':tableName/:id')
  @ApiOperation({ summary: 'Delete a record by ID or primary key with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async deleteRow(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
  ) {
    return this.apiGatewayService.deleteRow(
      this.getApiContext(req),
      schema,
      tableName,
      id,
      pk,
    );
  }

  @Delete(':tableName')
  @ApiOperation({ summary: 'Delete matching records using PostgREST filters with RLS' })
  @ApiHeader({ name: 'apikey', required: false })
  @ApiHeader({ name: 'X-Tenant-ID', required: false })
  async deleteRowsByFilter(
    @Req() req: Request,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Query() queryParams: Record<string, any>,
  ) {
    return this.apiGatewayService.deleteRowsByFilter(
      this.getApiContext(req),
      schema,
      tableName,
      queryParams,
    );
  }
}
