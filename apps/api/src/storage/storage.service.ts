import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';

export interface StorageBucket {
  name: string;
  originalName: string;
  createdAt: Date;
  isPublic: boolean;
}

export interface StorageFile {
  key: string;
  name: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

export interface StorageStats {
  totalBuckets: number;
  totalFiles: number;
  totalSizeBytes: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly endpoint: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const endPoint = this.config.get<string>('minio.endPoint', 'localhost');
    const port = this.config.get<number>('minio.port', 9000);
    const useSSL = this.config.get<boolean>('minio.useSSL', false);
    const accessKey = this.config.get<string>('minio.accessKey', 'minioadmin');
    const secretKey = this.config.get<string>('minio.secretKey', 'minioadmin');
    const region = this.config.get<string>('minio.region', 'us-east-1');

    const protocol = useSSL ? 'https' : 'http';
    this.endpoint = `${protocol}://${endPoint}:${port}`;

    this.s3Client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  private async resolveProjectRef(identifier: string): Promise<string> {
    const project = await this.prisma.project.findFirst({
      where: {
        status: { not: 'DELETED' },
        OR: [{ ref: identifier }, { slug: identifier }, { id: identifier }],
      },
      select: { ref: true },
    });
    if (!project) throw new NotFoundException(`Project "${identifier}" not found`);
    return project.ref;
  }

  getTenantBucketPrefix(projectRef: string): string {
    return `skynode-p-${projectRef}-`;
  }

  getTenantBucketName(projectRef: string, bucketName: string): string {
    const prefix = this.getTenantBucketPrefix(projectRef);
    if (bucketName.startsWith(prefix)) return bucketName;
    return `${prefix}${bucketName.toLowerCase()}`;
  }

  extractOriginalBucketName(projectRef: string, tenantBucketName: string): string {
    const prefix = this.getTenantBucketPrefix(projectRef);
    if (tenantBucketName.startsWith(prefix)) {
      return tenantBucketName.slice(prefix.length);
    }
    return tenantBucketName;
  }

  async listBuckets(identifier: string): Promise<StorageBucket[]> {
    const projectRef = await this.resolveProjectRef(identifier);
    const prefix = this.getTenantBucketPrefix(projectRef);

    try {
      const res = await this.s3Client.send(new ListBucketsCommand({}));
      const buckets = res.Buckets ?? [];

      return buckets
        .filter((b) => b.Name?.startsWith(prefix))
        .map((b) => ({
          name: b.Name!,
          originalName: this.extractOriginalBucketName(projectRef, b.Name!),
          createdAt: b.CreationDate ?? new Date(),
          isPublic: false,
        }));
    } catch (err: any) {
      this.logger.error(`Failed to list buckets: ${err.message}`);
      return [];
    }
  }

  async createBucket(
    identifier: string,
    bucketName: string,
    isPublic = false,
  ): Promise<StorageBucket> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);

    try {
      await this.s3Client.send(new CreateBucketCommand({ Bucket: tenantBucket }));
      return {
        name: tenantBucket,
        originalName: bucketName.toLowerCase(),
        createdAt: new Date(),
        isPublic,
      };
    } catch (err: any) {
      if (err.name === 'BucketAlreadyOwnedByYou' || err.name === 'BucketAlreadyExists') {
        throw new ConflictException(`Bucket "${bucketName}" already exists`);
      }
      this.logger.error(`Failed to create bucket ${tenantBucket}: ${err.message}`);
      throw new BadRequestException(`Could not create bucket: ${err.message}`);
    }
  }

  async deleteBucket(identifier: string, bucketName: string): Promise<void> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);

    try {
      // Check if bucket has objects
      const objects = await this.s3Client.send(
        new ListObjectsV2Command({ Bucket: tenantBucket, MaxKeys: 1 }),
      );
      if (objects.KeyCount && objects.KeyCount > 0) {
        throw new BadRequestException('Bucket is not empty. Delete all objects first.');
      }
      await this.s3Client.send(new DeleteBucketCommand({ Bucket: tenantBucket }));
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new NotFoundException(`Bucket "${bucketName}" not found or delete failed`);
    }
  }

  async listFiles(
    identifier: string,
    bucketName: string,
    prefix?: string,
  ): Promise<StorageFile[]> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);

    try {
      const res = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: tenantBucket,
          Prefix: prefix,
        }),
      );

      return (res.Contents ?? []).map((item) => ({
        key: item.Key ?? '',
        name: item.Key?.split('/').pop() ?? item.Key ?? '',
        size: item.Size ?? 0,
        lastModified: item.LastModified ?? new Date(),
      }));
    } catch (err: any) {
      this.logger.error(`Failed to list files in ${tenantBucket}: ${err.message}`);
      return [];
    }
  }

  async getUploadUrl(
    identifier: string,
    bucketName: string,
    fileName: string,
    contentType = 'application/octet-stream',
  ): Promise<{ uploadUrl: string; key: string; bucket: string }> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);
    const key = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const command = new PutObjectCommand({
      Bucket: tenantBucket,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });

    return {
      uploadUrl,
      key,
      bucket: bucketName,
    };
  }

  async getDownloadUrl(
    identifier: string,
    bucketName: string,
    key: string,
  ): Promise<{ downloadUrl: string; key: string; expiresIn: number }> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);

    const command = new GetObjectCommand({
      Bucket: tenantBucket,
      Key: key,
    });

    const expiresIn = 3600;
    const downloadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      downloadUrl,
      key,
      expiresIn,
    };
  }

  async deleteFile(identifier: string, bucketName: string, key: string): Promise<void> {
    const projectRef = await this.resolveProjectRef(identifier);
    const tenantBucket = this.getTenantBucketName(projectRef, bucketName);

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: tenantBucket,
          Key: key,
        }),
      );
    } catch (err: any) {
      throw new BadRequestException(`Could not delete file: ${err.message}`);
    }
  }

  async getStats(identifier: string): Promise<StorageStats> {
    const buckets = await this.listBuckets(identifier);
    let totalFiles = 0;
    let totalSizeBytes = 0;

    for (const b of buckets) {
      const files = await this.listFiles(identifier, b.originalName);
      totalFiles += files.length;
      totalSizeBytes += files.reduce((acc, f) => acc + f.size, 0);
    }

    return {
      totalBuckets: buckets.length,
      totalFiles,
      totalSizeBytes,
    };
  }
}
