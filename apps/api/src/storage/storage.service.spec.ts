import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PrismaService } from '../prisma/prisma.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-s3.local/presigned-url'),
}));

const mockPrisma = {
  project: {
    findFirst: jest.fn().mockResolvedValue({
      ref: 'pref1234567',
      status: 'ACTIVE',
    }),
  },
};

const mockConfig = {
  get: jest.fn((key: string, defaultValue?: any) => defaultValue),
};

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    mockSend.mockReset();
    mockPrisma.project.findFirst.mockResolvedValue({
      ref: 'pref1234567',
      status: 'ACTIVE',
    });

    const module = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('listBuckets', () => {
    it('returns tenant buckets with original names', async () => {
      mockSend.mockResolvedValueOnce({
        Buckets: [
          { Name: 'skynode-p-pref1234567-avatars', CreationDate: new Date() },
          { Name: 'skynode-p-other-uploads', CreationDate: new Date() },
        ],
      });

      const buckets = await service.listBuckets('pref1234567');
      expect(buckets).toHaveLength(1);
      expect(buckets[0]!.originalName).toBe('avatars');
      expect(buckets[0]!.name).toBe('skynode-p-pref1234567-avatars');
    });
  });

  describe('createBucket', () => {
    it('creates bucket with tenant prefix', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await service.createBucket('pref1234567', 'assets', false);
      expect(result.name).toBe('skynode-p-pref1234567-assets');
      expect(result.originalName).toBe('assets');
    });

    it('throws ConflictException if bucket already exists', async () => {
      const err: any = new Error('Bucket exists');
      err.name = 'BucketAlreadyOwnedByYou';
      mockSend.mockRejectedValueOnce(err);

      await expect(service.createBucket('pref1234567', 'assets')).rejects.toThrow(ConflictException);
    });
  });

  describe('listFiles', () => {
    it('returns mapped objects list', async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [
          { Key: 'images/logo.png', Size: 1024, LastModified: new Date() },
        ],
      });

      const files = await service.listFiles('pref1234567', 'assets');
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe('logo.png');
      expect(files[0]!.size).toBe(1024);
    });
  });

  describe('getUploadUrl', () => {
    it('returns presigned upload URL and generated key', async () => {
      const result = await service.getUploadUrl('pref1234567', 'assets', 'test.png', 'image/png');
      expect(result).toHaveProperty('uploadUrl');
      expect(result.uploadUrl).toBe('https://mock-s3.local/presigned-url');
      expect(result.key).toContain('test.png');
    });
  });

  describe('getDownloadUrl', () => {
    it('returns presigned download URL', async () => {
      const result = await service.getDownloadUrl('pref1234567', 'assets', 'images/logo.png');
      expect(result.downloadUrl).toBe('https://mock-s3.local/presigned-url');
      expect(result.key).toBe('images/logo.png');
    });
  });
});
