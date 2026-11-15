import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseProvisionerService } from './provisioning/database-provisioner.service';
import { CreateProjectDto, UpdateProjectDto, CreateProjectApiKeyDto } from './dto/project.dto';
import { encrypt, decrypt } from '../common/utils/crypto.util';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getProjectOrConditions(identifier: string): Array<{ id?: string; slug?: string; ref?: string }> {
  const or: Array<{ id?: string; slug?: string; ref?: string }> = [
    { slug: identifier },
    { ref: identifier },
  ];
  if (UUID_REGEX.test(identifier)) {
    or.push({ id: identifier });
  }
  return or;
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: DatabaseProvisionerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generates a slug from the project name.
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  /**
   * Ensure unique slug by appending counter if needed.
   */
  private async getUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (await this.prisma.project.findUnique({ where: { slug } })) {
      counter++;
      slug = `${baseSlug.slice(0, 45)}-${counter}`;
    }

    return slug;
  }

  /**
   * Helper to generate high-entropy API key.
   */
  private generateApiKey(type: 'anon' | 'service_role', ref: string): { key: string; prefix: string; hash: string } {
    const randomHex = randomBytes(24).toString('hex');
    const key = `sky_${type}_${ref}_${randomHex}`;
    const prefix = key.slice(0, 12);
    const hash = createHash('sha256').update(key).digest('hex');

    return { key, prefix, hash };
  }

  /**
   * Create and provision a new project.
   */
  async create(ownerId: string, dto: CreateProjectDto) {
    const baseSlug = this.generateSlug(dto.name);
    const slug = await this.getUniqueSlug(baseSlug);
    const ref = this.provisioner.generateProjectRef();

    this.logger.log(`Creating project "${dto.name}" with ref ${ref} and slug ${slug}`);

    // 1. Provision dedicated PostgreSQL database & roles
    const provisionResult = await this.provisioner.provision(ref);

    // 2. Encrypt database password
    const dbPasswordEnc = encrypt(provisionResult.dbPasswordPlain);

    // 3. Generate default API keys
    const anonKeyInfo = this.generateApiKey('anon', ref);
    const serviceKeyInfo = this.generateApiKey('service_role', ref);

    // 4. Create Project record and default API keys in transaction
    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          ref,
          slug,
          name: dto.name,
          description: dto.description,
          ownerId,
          region: dto.region || 'default',
          dbHost: provisionResult.dbHost,
          dbPort: provisionResult.dbPort,
          dbName: provisionResult.dbName,
          dbUser: provisionResult.dbUser,
          dbPasswordEnc,
          status: 'ACTIVE',
        },
      });

      // Default publishable anon key
      await tx.apiKey.create({
        data: {
          projectId: created.id,
          name: 'Default Anon Key',
          type: 'PUBLISHABLE',
          keyPrefix: anonKeyInfo.prefix,
          keyHash: anonKeyInfo.hash,
        },
      });

      // Default secret service_role key
      await tx.apiKey.create({
        data: {
          projectId: created.id,
          name: 'Default Service Role Key',
          type: 'SECRET',
          keyPrefix: serviceKeyInfo.prefix,
          keyHash: serviceKeyInfo.hash,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: ownerId,
          actorType: 'PLATFORM_USER',
          action: 'project.create',
          resourceType: 'project',
          resourceId: created.id,
          metadata: { name: created.name, ref: created.ref, slug: created.slug },
        },
      });

      return created;
    });

    this.logger.log(`Project ${project.name} (${project.ref}) created and active`);

    return {
      id: project.id,
      ref: project.ref,
      slug: project.slug,
      name: project.name,
      description: project.description,
      status: project.status.toLowerCase(),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      anonKey: anonKeyInfo.key,
      serviceKey: serviceKeyInfo.key,
    };
  }

  /**
   * List all projects owned by user.
   */
  async findAll(ownerId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId, status: { not: 'DELETED' } },
      select: {
        id: true,
        ref: true,
        slug: true,
        name: true,
        description: true,
        status: true,
        region: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return projects.map((p) => ({
      ...p,
      status: p.status.toLowerCase(),
    }));
  }

  /**
   * Find project by ID, slug, or ref.
   */
  async findOne(identifier: string, ownerId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        ownerId,
        status: { not: 'DELETED' },
        OR: getProjectOrConditions(identifier),
      },
      include: {
        apiKeys: {
          select: {
            id: true,
            name: true,
            type: true,
            keyPrefix: true,
            createdAt: true,
            lastUsedAt: true,
            revoked: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project "${identifier}" not found`);
    }

    return {
      id: project.id,
      ref: project.ref,
      slug: project.slug,
      name: project.name,
      description: project.description,
      status: project.status.toLowerCase(),
      region: project.region,
      databaseName: project.dbName,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      apiKeys: project.apiKeys,
    };
  }

  /**
   * Update project settings.
   */
  async update(identifier: string, ownerId: string, dto: UpdateProjectDto) {
    const existing = await this.findOne(identifier, ownerId);

    const data: Record<string, any> = {};
    if (dto.name && dto.name !== existing.name) {
      data.name = dto.name;
      const baseSlug = this.generateSlug(dto.name);
      data.slug = await this.getUniqueSlug(baseSlug);
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }

    const updated = await this.prisma.project.update({
      where: { id: existing.id },
      data,
    });

    return {
      id: updated.id,
      ref: updated.ref,
      slug: updated.slug,
      name: updated.name,
      description: updated.description,
      status: updated.status.toLowerCase(),
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Delete a project and tear down its database.
   */
  async remove(identifier: string, ownerId: string) {
    const project = await this.findOne(identifier, ownerId);

    this.logger.log(`Deleting project ${project.name} (${project.ref})`);

    // 1. Mark as DELETING in DB
    await this.prisma.project.update({
      where: { id: project.id },
      data: { status: 'DELETING' },
    });

    // 2. Tear down PostgreSQL database & roles
    await this.provisioner.teardown(project.ref);

    // 3. Mark as DELETED or delete record
    await this.prisma.project.delete({
      where: { id: project.id },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        actorId: ownerId,
        actorType: 'PLATFORM_USER',
        action: 'project.delete',
        resourceType: 'project',
        resourceId: project.id,
        metadata: { name: project.name, ref: project.ref },
      },
    });

    return { message: `Project ${project.name} deleted successfully` };
  }

  /**
   * Get API credentials and endpoints configuration for a project.
   */
  async getApiConfig(identifier: string, ownerId: string) {
    const project = await this.findOne(identifier, ownerId);

    const publicBaseUrl =
      this.config.get<string>('APP_URL') ||
      `http://localhost:${this.config.get<string>('APP_PORT', '4000')}`;

    // Return baseUrl and keys
    return {
      baseUrl: `${publicBaseUrl}/api/v1/projects/${project.ref}/rest`,
      ref: project.ref,
      slug: project.slug,
      anonKey: `sky_anon_${project.ref}_active`,
      serviceKey: `sky_service_${project.ref}_active`,
    };
  }

  /**
   * Get Database connection credentials for a project.
   */
  async getDatabaseConfig(identifier: string, ownerId: string) {
    const projectRecord = await this.prisma.project.findFirst({
      where: {
        ownerId,
        status: { not: 'DELETED' },
        OR: getProjectOrConditions(identifier),
      },
    });

    if (!projectRecord) {
      throw new NotFoundException(`Project "${identifier}" not found`);
    }

    const passwordPlain = decrypt(projectRecord.dbPasswordEnc);
    const connectionUri = `postgresql://${projectRecord.dbUser}:${passwordPlain}@${projectRecord.dbHost}:${projectRecord.dbPort}/${projectRecord.dbName}`;

    return {
      host: projectRecord.dbHost,
      port: projectRecord.dbPort,
      database: projectRecord.dbName,
      user: projectRecord.dbUser,
      password: passwordPlain,
      connectionUri,
    };
  }

  /**
   * Create an additional scoped API key.
   */
  async createApiKey(identifier: string, ownerId: string, dto: CreateProjectApiKeyDto) {
    const project = await this.findOne(identifier, ownerId);
    const type = dto.type === 'SECRET' ? 'service_role' : 'anon';
    const keyInfo = this.generateApiKey(type, project.ref);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        projectId: project.id,
        name: dto.name,
        type: dto.type === 'SECRET' ? 'SECRET' : 'PUBLISHABLE',
        keyPrefix: keyInfo.prefix,
        keyHash: keyInfo.hash,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      type: apiKey.type,
      key: keyInfo.key,
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt,
    };
  }
}
