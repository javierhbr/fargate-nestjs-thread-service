import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import {
  FileStoragePort,
  UploadFileOptions,
  UploadResult,
  DownloadResult,
} from '../../src/application/ports/output/file-storage.port';

interface StoredFile {
  buffer: Buffer;
  contentType?: string;
  metadata?: Record<string, string>;
  etag: string;
  uploadedAt: Date;
}

/**
 * In-Memory File Storage Adapter
 * For ATDD testing - stores files in memory without S3 dependencies
 */
@Injectable()
export class InMemoryFileStorageAdapter implements FileStoragePort {
  private storage: Map<string, Map<string, StoredFile>> = new Map();

  async uploadStream(
    bucket: string,
    key: string,
    stream: Readable,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    const buffer = await this.streamToBuffer(stream);
    return this.uploadBuffer(bucket, key, buffer, options);
  }

  async uploadBuffer(
    bucket: string,
    key: string,
    buffer: Buffer,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    const etag = this.calculateETag(buffer);

    const file: StoredFile = {
      buffer,
      contentType: options?.contentType,
      metadata: options?.metadata,
      etag,
      uploadedAt: new Date(),
    };

    if (!this.storage.has(bucket)) {
      this.storage.set(bucket, new Map());
    }

    this.storage.get(bucket)!.set(key, file);

    return {
      key,
      bucket,
      etag,
      location: `s3://${bucket}/${key}`,
    };
  }

  async uploadFile(
    bucket: string,
    key: string,
    filePath: string,
    options?: UploadFileOptions,
  ): Promise<UploadResult> {
    // In tests, we don't actually read from filesystem
    // This is a mock implementation
    throw new Error(
      'uploadFile not supported in in-memory adapter. Use uploadBuffer instead.',
    );
  }

  async downloadStream(bucket: string, key: string): Promise<DownloadResult> {
    const file = this.getFile(bucket, key);

    if (!file) {
      throw new Error(`File not found: s3://${bucket}/${key}`);
    }

    const stream = Readable.from(file.buffer);

    return {
      stream,
      contentType: file.contentType,
      contentLength: file.buffer.length,
      metadata: file.metadata,
      etag: file.etag,
    };
  }

  async downloadFile(
    bucket: string,
    key: string,
    destinationPath: string,
  ): Promise<void> {
    // In tests, we don't actually write to filesystem
    // This is a mock implementation
    throw new Error(
      'downloadFile not supported in in-memory adapter. Use downloadStream instead.',
    );
  }

  async fileExists(bucket: string, key: string): Promise<boolean> {
    const bucketStorage = this.storage.get(bucket);
    if (!bucketStorage) {
      return false;
    }
    return bucketStorage.has(key);
  }

  async deleteFile(bucket: string, key: string): Promise<void> {
    const bucketStorage = this.storage.get(bucket);
    if (bucketStorage) {
      bucketStorage.delete(key);
    }
  }

  async deleteFiles(bucket: string, keys: string[]): Promise<void> {
    const bucketStorage = this.storage.get(bucket);
    if (bucketStorage) {
      keys.forEach((key) => bucketStorage.delete(key));
    }
  }

  async getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string> {
    // Return a mock presigned URL
    const file = this.getFile(bucket, key);
    if (!file) {
      throw new Error(`File not found: s3://${bucket}/${key}`);
    }

    const timestamp = Date.now() + expiresIn * 1000;
    return `https://${bucket}.s3.amazonaws.com/${key}?expires=${timestamp}&signature=mock`;
  }

  async getFileMetadata(
    bucket: string,
    key: string,
  ): Promise<{ contentLength: number; contentType?: string; etag?: string }> {
    const file = this.getFile(bucket, key);

    if (!file) {
      throw new Error(`File not found: s3://${bucket}/${key}`);
    }

    return {
      contentLength: file.buffer.length,
      contentType: file.contentType,
      etag: file.etag,
    };
  }

  // Test helper methods

  /**
   * Get file content as Buffer (for test assertions)
   */
  getFileContent(bucket: string, key: string): Buffer | null {
    const file = this.getFile(bucket, key);
    return file ? file.buffer : null;
  }

  /**
   * Get all files in a bucket
   */
  listFiles(bucket: string): string[] {
    const bucketStorage = this.storage.get(bucket);
    return bucketStorage ? Array.from(bucketStorage.keys()) : [];
  }

  /**
   * Get total file count across all buckets
   */
  getFileCount(): number {
    let count = 0;
    this.storage.forEach((bucket) => {
      count += bucket.size;
    });
    return count;
  }

  /**
   * Clear all storage
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Create a mock downloadable file for testing
   */
  createMockFile(
    bucket: string,
    key: string,
    content: string | Buffer,
    contentType?: string,
  ): void {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const etag = this.calculateETag(buffer);

    const file: StoredFile = {
      buffer,
      contentType,
      etag,
      uploadedAt: new Date(),
    };

    if (!this.storage.has(bucket)) {
      this.storage.set(bucket, new Map());
    }

    this.storage.get(bucket)!.set(key, file);
  }

  private getFile(bucket: string, key: string): StoredFile | null {
    const bucketStorage = this.storage.get(bucket);
    if (!bucketStorage) {
      return null;
    }
    return bucketStorage.get(key) || null;
  }

  private calculateETag(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}
