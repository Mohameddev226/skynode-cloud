import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseProvisionerService } from './provisioning/database-provisioner.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { encrypt } from '../common/utils/crypto.util';

describe('ProjectsService', () => {
  let service: ProjectsService;

  const mockPrisma = {
    project: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    apiKey: {
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockProvisioner = {
    generateProjectRef: jest.fn(() => 'pabcdef12345'),
    provision: jest.fn(),
    teardown: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string, defaultVal?: any) => defaultVal ?? 'test'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DatabaseProvisionerService, useValue: mockProvisioner },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('create', () => {
    it('should provision database, encrypt password, and create project with default API keys', async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);
      mockProvisioner.provision.mockResolvedValue({
        ref: 'pabcdef12345',
        dbHost: 'localhost',
        dbPort: 5432,
        dbName: 'skynode_proj_pabcdef12345',
        dbUser: 'proj_pabcdef12345_admin',
        dbPasswordPlain: 'super-secret-db-pass-1234',
      });

      mockPrisma.project.create.mockResolvedValue({
        id: 'proj-uuid',
        ref: 'pabcdef12345',
        slug: 'dugsihub',
        name: 'Dugsihub',
        description: 'Learning app',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await service.create('user-uuid', {
        name: 'Dugsihub',
        description: 'Learning app',
      });

      expect(mockProvisioner.provision).toHaveBeenCalledWith('pabcdef12345');
      expect(mockPrisma.project.create).toHaveBeenCalled();
      expect(mockPrisma.apiKey.create).toHaveBeenCalledTimes(2);
      expect(res.name).toBe('Dugsihub');
      expect(res.slug).toBe('dugsihub');
      expect(res.anonKey).toBeDefined();
      expect(res.serviceKey).toBeDefined();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if project does not exist', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);

      await expect(service.findOne('non-existent', 'user-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return project details when found', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        ref: 'p12345678901',
        slug: 'sometrade',
        name: 'SomeTrade',
        status: 'ACTIVE',
        region: 'default',
        dbName: 'skynode_proj_p12345678901',
        createdAt: new Date(),
        updatedAt: new Date(),
        apiKeys: [],
      });

      const project = await service.findOne('sometrade', 'user-uuid');
      expect(project.name).toBe('SomeTrade');
      expect(project.slug).toBe('sometrade');
    });
  });

  describe('getDatabaseConfig', () => {
    it('should decrypt stored password and construct connection URI', async () => {
      const plaintextPass = 'my_raw_db_password_xyz';
      const encryptedPass = encrypt(plaintextPass);

      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        ref: 'p12345678901',
        slug: 'sometrade',
        dbHost: '127.0.0.1',
        dbPort: 5432,
        dbName: 'skynode_proj_p12345678901',
        dbUser: 'proj_p12345678901_admin',
        dbPasswordEnc: encryptedPass,
      });

      const config = await service.getDatabaseConfig('sometrade', 'user-uuid');
      expect(config.password).toBe(plaintextPass);
      expect(config.connectionUri).toContain(plaintextPass);
      expect(config.user).toBe('proj_p12345678901_admin');
    });
  });

  describe('remove', () => {
    it('should invoke provisioner teardown and delete project record', async () => {
      mockPrisma.project.findFirst.mockResolvedValue({
        id: 'proj-1',
        ref: 'p12345678901',
        slug: 'to-delete',
        name: 'To Delete',
        status: 'ACTIVE',
      });
      mockPrisma.project.update.mockResolvedValue({});
      mockProvisioner.teardown.mockResolvedValue(undefined);
      mockPrisma.project.delete.mockResolvedValue({});

      const res = await service.remove('to-delete', 'user-uuid');
      expect(mockProvisioner.teardown).toHaveBeenCalledWith('p12345678901');
      expect(mockPrisma.project.delete).toHaveBeenCalledWith({ where: { id: 'proj-1' } });
      expect(res.message).toContain('deleted successfully');
    });
  });
});
