import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { ApiGatewayService } from './api-gateway.service';

@ApiTags('Auto REST API')
@Controller('projects/:identifier/rest/v1')
export class ApiGatewayController {
  constructor(private readonly apiGatewayService: ApiGatewayService) {}

  @Get(':tableName')
  @ApiOperation({ summary: 'Query table records with PostgREST-style filters' })
  @ApiHeader({ name: 'apikey', required: false, description: 'Anon or Service Role key' })
  async getRows(
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Query() queryParams: Record<string, any>,
    @Headers('apikey') apiKey?: string,
  ) {
    return this.apiGatewayService.getRows(
      identifier,
      schema,
      tableName,
      queryParams,
      apiKey,
    );
  }

  @Get(':tableName/:id')
  @ApiOperation({ summary: 'Get single record by ID or primary key' })
  async getRowById(
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
  ) {
    const record = await this.apiGatewayService.getRowById(
      identifier,
      schema,
      tableName,
      id,
      pk,
    );
    return { data: record };
  }

  @Post(':tableName')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Insert single or multiple records into a table' })
  async insertRow(
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Query('schema') schema = 'public',
    @Body() payload: Record<string, any> | Record<string, any>[],
  ) {
    const inserted = await this.apiGatewayService.insertRow(
      identifier,
      schema,
      tableName,
      payload,
    );
    return { data: inserted };
  }

  @Patch(':tableName/:id')
  @ApiOperation({ summary: 'Update a record by ID or primary key' })
  async updateRow(
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
    @Body() data: Record<string, any>,
  ) {
    const updated = await this.apiGatewayService.updateRow(
      identifier,
      schema,
      tableName,
      id,
      pk,
      data,
    );
    return { data: updated };
  }

  @Delete(':tableName/:id')
  @ApiOperation({ summary: 'Delete a record by ID or primary key' })
  async deleteRow(
    @Param('identifier') identifier: string,
    @Param('tableName') tableName: string,
    @Param('id') id: string,
    @Query('pk') pk = 'id',
    @Query('schema') schema = 'public',
  ) {
    const result = await this.apiGatewayService.deleteRow(
      identifier,
      schema,
      tableName,
      id,
      pk,
    );
    return result;
  }
}
