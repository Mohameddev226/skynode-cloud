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
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
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
   * Derives a cryptographically verifiable default project API key using server HMAC secret.
   * Ensures existing and new projects have working non-guessable keys in the dashboard config.
   */
  private deriveDefaultApiKey(type: 'anon' | 'service_role', projectId: string, ref: string): string {
    const secret =
      this.config.get<string>('ENCRYPTION_KEY') ||
      this.config.get<string>('JWT_SECRET') ||
      'skynode-default-hmac-secret';
    const sig = createHmac('sha256', secret)
      .update(`${type}:${projectId}:${ref}`)
      .digest('hex')
      .slice(0, 32);
    return `sky_${type}_${ref}_${sig}`;
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

    // 3. Generate default API keys (deterministic HMAC-signed keys on creation so config remains verifiable)
    const tempAnon = this.generateApiKey('anon', ref);
    const tempService = this.generateApiKey('service_role', ref);

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
      const derivedAnon = this.deriveDefaultApiKey('anon', created.id, ref);
      await tx.apiKey.create({
        data: {
          projectId: created.id,
          name: 'Default Anon Key',
          type: 'PUBLISHABLE',
          keyPrefix: derivedAnon.slice(0, 12),
          keyHash: createHash('sha256').update(derivedAnon).digest('hex'),
        },
      });

      // Default secret service_role key
      const derivedService = this.deriveDefaultApiKey('service_role', created.id, ref);
      await tx.apiKey.create({
        data: {
          projectId: created.id,
          name: 'Default Service Role Key',
          type: 'SECRET',
          keyPrefix: derivedService.slice(0, 12),
          keyHash: createHash('sha256').update(derivedService).digest('hex'),
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

      return { created, anonKey: derivedAnon, serviceKey: derivedService };
    });

    this.logger.log(`Project ${project.created.name} (${project.created.ref}) created and active`);

    return {
      id: project.created.id,
      ref: project.created.ref,
      slug: project.created.slug,
      name: project.created.name,
      description: project.created.description,
      status: project.created.status.toLowerCase(),
      createdAt: project.created.createdAt,
      updatedAt: project.created.updatedAt,
      anonKey: project.anonKey || tempAnon.key,
      serviceKey: project.serviceKey || tempService.key,
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
    try {
      await this.provisioner.teardown(project.ref);
    } catch (tdErr: any) {
      this.logger.warn(`Teardown notice for project ${project.ref}: ${tdErr.message}`);
    }

    // 3. Mark as DELETED or delete record
    await this.prisma.project.delete({
      where: { id: project.id },
    });

    // Audit log
    try {
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
    } catch (auditErr: any) {
      this.logger.warn(`Audit log notice: ${auditErr.message}`);
    }

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

    return {
      baseUrl: `${publicBaseUrl}/api/v1/projects/${project.ref}`,
      ref: project.ref,
      slug: project.slug,
      anonKey: this.deriveDefaultApiKey('anon', project.id, project.ref),
      serviceKey: this.deriveDefaultApiKey('service_role', project.id, project.ref),
    };
  }

  /**
   * Validates an API key (anon or service_role) against a project.
   * Checks stored SHA-256 hashes in api_keys and cryptographically derived defaults.
   */
  async validateApiKey(
    identifier: string,
    rawKey: string,
  ): Promise<{ projectId: string; ref: string; role: 'anon' | 'service_role' } | null> {
    if (!rawKey || typeof rawKey !== 'string') return null;

    const projectRecord = await this.prisma.project.findFirst({
      where: {
        status: { not: 'DELETED' },
        OR: getProjectOrConditions(identifier),
      },
      select: { id: true, ref: true },
    });

    if (!projectRecord) return null;

    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    if (this.prisma.apiKey?.findFirst) {
      const matched = await this.prisma.apiKey.findFirst({
        where: {
          projectId: projectRecord.id,
          keyHash,
        },
        select: { id: true, type: true, revoked: true, expiresAt: true },
      });

      if (matched) {
        if (matched.revoked) return null;
        if (matched.expiresAt && matched.expiresAt < new Date()) return null;

        // Non-blocking audit update
        if (this.prisma.apiKey.update) {
          this.prisma.apiKey
            .update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } })
            .catch(() => {});
        }

        return {
          projectId: projectRecord.id,
          ref: projectRecord.ref,
          role: matched.type === 'SECRET' ? 'service_role' : 'anon',
        };
      }
    }

    // Legacy fallback: check cryptographically signed HMAC default key (non-guessable)
    const derivedAnon = this.deriveDefaultApiKey('anon', projectRecord.id, projectRecord.ref);
    const derivedService = this.deriveDefaultApiKey('service_role', projectRecord.id, projectRecord.ref);

    const safeEquals = (a: string, b: string) => {
      const bufA = Buffer.from(a);
      const bufB = Buffer.from(b);
      return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
    };

    if (safeEquals(rawKey, derivedAnon)) {
      return { projectId: projectRecord.id, ref: projectRecord.ref, role: 'anon' };
    }
    if (safeEquals(rawKey, derivedService)) {
      return { projectId: projectRecord.id, ref: projectRecord.ref, role: 'service_role' };
    }

    return null;
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

    let passwordPlain = '';
    let forceFallback = false;
    try {
      passwordPlain = decrypt(projectRecord.dbPasswordEnc);
    } catch (decErr: any) {
      this.logger.warn(
        `Could not decrypt dbPasswordEnc for project ${projectRecord.ref} (${decErr?.message}); using shared DB fallback.`,
      );
      forceFallback = true;
    }

    const connectionUri = `postgresql://${projectRecord.dbUser}:${passwordPlain}@${projectRecord.dbHost}:${projectRecord.dbPort}/${projectRecord.dbName}`;

    return {
      host: projectRecord.dbHost,
      port: projectRecord.dbPort,
      database: projectRecord.dbName,
      user: projectRecord.dbUser,
      password: passwordPlain,
      forceFallback,
      connectionUri,
    };
  }

  /**
   * Get database credentials for a project by ref or slug (for REST API / Realtime).
   */
  async getProjectCredentialsByRef(identifier: string) {
    const projectRecord = await this.prisma.project.findFirst({
      where: {
        status: { not: 'DELETED' },
        OR: getProjectOrConditions(identifier),
      },
    });

    if (!projectRecord) {
      throw new NotFoundException(`Project "${identifier}" not found`);
    }

    let passwordPlain = '';
    let forceFallback = false;
    try {
      passwordPlain = decrypt(projectRecord.dbPasswordEnc);
    } catch (decErr: any) {
      this.logger.warn(
        `Could not decrypt dbPasswordEnc for project ${projectRecord.ref} (${decErr?.message}); using shared DB fallback.`,
      );
      forceFallback = true;
    }

    return {
      id: projectRecord.id,
      ref: projectRecord.ref,
      slug: projectRecord.slug,
      name: projectRecord.name,
      host: projectRecord.dbHost,
      port: projectRecord.dbPort,
      database: projectRecord.dbName,
      user: projectRecord.dbUser,
      password: passwordPlain,
      forceFallback,
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
