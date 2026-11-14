import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto, CreateProjectApiKeyDto } from './dto/project.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Projects')
@Controller('projects')
@UseGuards(AuthGuard)
@ApiCookieAuth()
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create and provision a new project' })
  @ApiResponse({ status: 201, description: 'Project created and database provisioned' })
  async create(
    @CurrentUser('userId') userId: string,
    @Body() dto: CreateProjectDto,
  ) {
    const project = await this.projectsService.create(userId, dto);
    return { data: project };
  }

  @Get()
  @ApiOperation({ summary: 'List all projects for current user' })
  @ApiResponse({ status: 200, description: 'List of projects' })
  async findAll(@CurrentUser('userId') userId: string) {
    const projects = await this.projectsService.findAll(userId);
    return { data: projects };
  }

  @Get(':identifier')
  @ApiOperation({ summary: 'Get project details by ID, slug, or ref' })
  @ApiResponse({ status: 200, description: 'Project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async findOne(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const project = await this.projectsService.findOne(identifier, userId);
    return { data: project };
  }

  @Patch(':identifier')
  @ApiOperation({ summary: 'Update project settings' })
  @ApiResponse({ status: 200, description: 'Project updated' })
  async update(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.update(identifier, userId, dto);
    return { data: project };
  }

  @Delete(':identifier')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a project and tear down database' })
  @ApiResponse({ status: 200, description: 'Project deleted' })
  async remove(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const result = await this.projectsService.remove(identifier, userId);
    return { data: result };
  }

  @Get(':identifier/api/config')
  @ApiOperation({ summary: 'Get API configuration and credentials for project' })
  @ApiResponse({ status: 200, description: 'Project API credentials' })
  async getApiConfig(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const config = await this.projectsService.getApiConfig(identifier, userId);
    return { data: config };
  }

  @Get(':identifier/api/keys')
  @ApiOperation({ summary: 'List API keys for project' })
  async listApiKeys(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const project = await this.projectsService.findOne(identifier, userId);
    return { data: project.apiKeys };
  }

  @Post(':identifier/api/keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a scoped API key' })
  async createApiKey(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
    @Body() dto: CreateProjectApiKeyDto,
  ) {
    const key = await this.projectsService.createApiKey(identifier, userId, dto);
    return { data: key };
  }

  @Get(':identifier/database/config')
  @ApiOperation({ summary: 'Get database connection parameters for project' })
  async getDatabaseConfig(
    @CurrentUser('userId') userId: string,
    @Param('identifier') identifier: string,
  ) {
    const config = await this.projectsService.getDatabaseConfig(identifier, userId);
    return { data: config };
  }
}
