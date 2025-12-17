import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { AppConfig } from '../../../config/configuration';
import { PinoLoggerService } from '../../logging/pino-logger.service';

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface DownloadResult {
  filePath: string;
  size: number;
  contentType?: string;
  etag?: string;
}

@Injectable()
export class S3Service implements OnModuleDestroy {
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly prefix: string;

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const awsConfig = this.configService.get('aws', { infer: true })!;
    const s3Config = this.configService.get('s3', { infer: true })!;

    this.client = new S3Client({
      region: awsConfig.region,
      ...(awsConfig.endpoint && { endpoint: awsConfig.endpoint, forcePathStyle: true }),
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });

    this.bucketName = s3Config.bucketName;
    this.prefix = s3Config.prefix;

    this.logger.setContext(S3Service.name);
  }

  async uploadFile(
    key: string,
    filePath: string,
    options?: UploadOptions,
  ): Promise<{ key: string; etag: string; size: number }> {
    const fullKey = this.getFullKey(key);
    const stats = await fs.stat(filePath);
    const fileStream = createReadStream(filePath);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: fullKey,
        Body: fileStream,
        ContentType: options?.contentType,
        Metadata: options?.metadata,
        CacheControl: options?.cacheControl,
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024, // 10MB parts
      leavePartsOnError: false,
    });

    upload.on('httpUploadProgress', (progress) => {
      this.logger.debug(
        { key: fullKey, loaded: progress.loaded, total: progress.total },
        'Upload progress',
      );
    });

    const result = await upload.done();

    this.logger.info({ key: fullKey, size: stats.size }, 'File uploaded successfully');

    return {
      key: fullKey,
      etag: result.ETag || '',
      size: stats.size,
    };
  }

  async uploadStream(
    key: string,
    stream: Readable,
    options?: UploadOptions & { size?: number },
  ): Promise<{ key: string; etag: string }> {
    const fullKey = this.getFullKey(key);

    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: fullKey,
        Body: stream,
        ContentType: options?.contentType,
        Metadata: options?.metadata,
        CacheControl: options?.cacheControl,
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    const result = await upload.done();

    this.logger.info({ key: fullKey }, 'Stream uploaded successfully');

    return {
      key: fullKey,
      etag: result.ETag || '',
    };
  }

  async downloadToFile(key: string, destPath: string): Promise<DownloadResult> {
    const fullKey = this.getFullKey(key);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullKey,
      }),
    );

    const writeStream = createWriteStream(destPath);
    await pipeline(response.Body as Readable, writeStream);

    const stats = await fs.stat(destPath);

    this.logger.info(
      { key: fullKey, destPath, size: stats.size },
      'File downloaded successfully',
    );

    return {
      filePath: destPath,
      size: stats.size,
      contentType: response.ContentType,
      etag: response.ETag,
    };
  }

  async getObjectStream(key: string): Promise<Readable> {
    const fullKey = this.getFullKey(key);

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: fullKey,
      }),
    );

    return response.Body as Readable;
  }

  async headObject(
    key: string,
  ): Promise<{ size: number; contentType?: string; etag?: string } | null> {
    const fullKey = this.getFullKey(key);

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: fullKey,
        }),
      );

      return {
        size: response.ContentLength || 0,
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'name' in error &&
        error.name === 'NotFound'
      ) {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const fullKey = this.getFullKey(key);

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fullKey,
      }),
    );

    this.logger.info({ key: fullKey }, 'Object deleted');
  }

  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const fullKey = this.getFullKey(key);

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fullKey,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  private getFullKey(key: string): string {
    if (key.startsWith(this.prefix)) {
      return key;
    }
    return `${this.prefix}${key}`;
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
