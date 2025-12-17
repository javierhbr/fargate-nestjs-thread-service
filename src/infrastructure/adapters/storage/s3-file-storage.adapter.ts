import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import {
  FileStoragePort,
  UploadFileOptions,
  UploadResult,
  DownloadResult,
} from '../../../application/ports/output/file-storage.port';
import { S3Service } from '../../../shared/aws/s3/s3.service';

/**
 * S3 File Storage Adapter
 * Implements FileStoragePort using AWS S3
 */
@Injectable()
export class S3FileStorageAdapter implements FileStoragePort {
  private readonly logger = new Logger(S3FileStorageAdapter.name);

  constructor(private readonly s3Service: S3Service) {}

  async uploadStream(
    bucket: string,
    key: string,
    stream: Readable,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    this.logger.debug(`Uploading stream to S3: ${bucket}/${key}`);

    const result = await this.s3Service.uploadStream(bucket, key, stream, {
      contentType: options?.contentType,
      metadata: options?.metadata,
      serverSideEncryption: options?.serverSideEncryption,
      storageClass: options?.storageClass,
    });

    return {
      key,
      bucket,
      etag: result.ETag ?? '',
      versionId: result.VersionId,
      location: `s3://${bucket}/${key}`,
    };
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    buffer: Buffer,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    this.logger.debug(`Uploading buffer to S3: ${bucket}/${key} (${buffer.length} bytes)`);

    const result = await this.s3Service.uploadBuffer(bucket, key, buffer, {
      contentType: options?.contentType,
      metadata: options?.metadata,
      serverSideEncryption: options?.serverSideEncryption,
      storageClass: options?.storageClass,
    });

    return {
      key,
      bucket,
      etag: result.ETag ?? '',
      versionId: result.VersionId,
      location: `s3://${bucket}/${key}`,
    };
  }

  async uploadFile(
    bucket: string,
    key: string,
    filePath: string,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    this.logger.debug(`Uploading file to S3: ${bucket}/${key} from ${filePath}`);

    const result = await this.s3Service.uploadFile(bucket, key, filePath, {
      contentType: options?.contentType,
      metadata: options?.metadata,
      serverSideEncryption: options?.serverSideEncryption,
      storageClass: options?.storageClass,
    });

    return {
      key,
      bucket,
      etag: result.ETag ?? '',
      versionId: result.VersionId,
      location: `s3://${bucket}/${key}`,
    };
  }

  async downloadStream(bucket: string, key: string): Promise<DownloadResult> {
    this.logger.debug(`Downloading stream from S3: ${bucket}/${key}`);

    const result = await this.s3Service.downloadStream(bucket, key);

    return {
      stream: result.Body as Readable,
      contentType: result.ContentType,
      contentLength: result.ContentLength,
      metadata: result.Metadata,
      etag: result.ETag,
    };
  }

  async downloadFile(bucket: string, key: string, destinationPath: string): Promise<void> {
    this.logger.debug(`Downloading file from S3: ${bucket}/${key} to ${destinationPath}`);

    await this.s3Service.downloadFile(bucket, key, destinationPath);
  }

  async fileExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.s3Service.headObject(bucket, key);
      return true;
    } catch (error) {
      if ((error as any).name === 'NotFound' || (error as any).$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async deleteFile(bucket: string, key: string): Promise<void> {
    this.logger.debug(`Deleting file from S3: ${bucket}/${key}`);

    await this.s3Service.deleteObject(bucket, key);
  }

  async deleteFiles(bucket: string, keys: string[]): Promise<void> {
    this.logger.debug(`Deleting ${keys.length} files from S3: ${bucket}`);

    await this.s3Service.deleteObjects(bucket, keys);
  }

  async getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    this.logger.debug(`Generating presigned URL for S3: ${bucket}/${key}`);

    return this.s3Service.getPresignedUrl(bucket, key, expiresIn);
  }

  async getFileMetadata(
    bucket: string,
    key: string,
  ): Promise<{ contentLength: number; contentType?: string; etag?: string }> {
    const result = await this.s3Service.headObject(bucket, key);

    return {
      contentLength: result.ContentLength ?? 0,
      contentType: result.ContentType,
      etag: result.ETag,
    };
  }
}
