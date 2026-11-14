import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StorageService } from './storage.service';
import { CreateBucketDto, UploadUrlRequestDto } from './dto/storage.dto';
import { AuthGuard } from '../common/guards/auth.guard';

@Controller('api/v1/projects/:ref/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('stats')
  async getStats(@Param('ref') ref: string) {
    return this.storageService.getStats(ref);
  }

  @Get('buckets')
  async listBuckets(@Param('ref') ref: string) {
    return this.storageService.listBuckets(ref);
  }

  @Post('buckets')
  async createBucket(
    @Param('ref') ref: string,
    @Body() dto: CreateBucketDto,
  ) {
    return this.storageService.createBucket(ref, dto.name, dto.isPublic);
  }

  @Delete('buckets/:bucket')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBucket(
    @Param('ref') ref: string,
    @Param('bucket') bucket: string,
  ) {
    await this.storageService.deleteBucket(ref, bucket);
  }

  @Get('buckets/:bucket/files')
  async listFiles(
    @Param('ref') ref: string,
    @Param('bucket') bucket: string,
    @Query('prefix') prefix?: string,
  ) {
    return this.storageService.listFiles(ref, bucket, prefix);
  }

  @Post('buckets/:bucket/upload-url')
  async getUploadUrl(
    @Param('ref') ref: string,
    @Param('bucket') bucket: string,
    @Body() dto: UploadUrlRequestDto,
  ) {
    return this.storageService.getUploadUrl(
      ref,
      bucket,
      dto.fileName,
      dto.contentType ?? 'application/octet-stream',
    );
  }

  @Get('buckets/:bucket/download-url')
  async getDownloadUrl(
    @Param('ref') ref: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
  ) {
    return this.storageService.getDownloadUrl(ref, bucket, key);
  }

  @Delete('buckets/:bucket/files')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteFile(
    @Param('ref') ref: string,
    @Param('bucket') bucket: string,
    @Query('key') key: string,
  ) {
    await this.storageService.deleteFile(ref, bucket, key);
  }
}
