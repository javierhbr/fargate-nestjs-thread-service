import { Readable } from 'stream';

/**
 * Upload File Options
 */
export interface UploadFileOptions {
  contentType?: string;
  metadata?: Record<string, string>;
  serverSideEncryption?: string;
  storageClass?: string;
}

/**
 * Upload Result
 */
export interface UploadResult {
  key: string;
  bucket: string;
  etag: string;
  versionId?: string;
  location: string;
}

/**
 * Download Result
 */
export interface DownloadResult {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  etag?: string;
}

/**
 * File Storage Port (Driven Port)
 * Interface for file storage operations (S3)
 */
export interface FileStoragePort {
  /**
   * Upload a file from a stream
   */
  uploadStream(bucket: string, key: string, stream: Readable, options?: UploadFileOptions): Promise<UploadResult>;

  /**
   * Upload a file from a buffer
   */
  uploadBuffer(bucket: string, key: string, buffer: Buffer, options?: UploadFileOptions): Promise<UploadResult>;

  /**
   * Upload a file from a local path
   */
  uploadFile(bucket: string, key: string, filePath: string, options?: UploadFileOptions): Promise<UploadResult>;

  /**
   * Download a file as a stream
   */
  downloadStream(bucket: string, key: string): Promise<DownloadResult>;

  /**
   * Download a file to a local path
   */
  downloadFile(bucket: string, key: string, destinationPath: string): Promise<void>;

  /**
   * Check if a file exists
   */
  fileExists(bucket: string, key: string): Promise<boolean>;

  /**
   * Delete a file
   */
  deleteFile(bucket: string, key: string): Promise<void>;

  /**
   * Delete multiple files
   */
  deleteFiles(bucket: string, keys: string[]): Promise<void>;

  /**
   * Get a presigned URL for temporary access
   */
  getPresignedUrl(bucket: string, key: string, expiresIn: number): Promise<string>;

  /**
   * Get file metadata
   */
  getFileMetadata(bucket: string, key: string): Promise<{ contentLength: number; contentType?: string; etag?: string }>;
}
