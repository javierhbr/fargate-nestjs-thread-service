import { describe, it, expect, beforeEach, vi } from 'vitest';
import { S3FileStorageAdapter } from '../../../src/infrastructure/adapters/storage/s3-file-storage.adapter';
import {
  createMockS3Service,
  createMockLogger,
  createMockReadableStream,
  createBlockingDetector,
  TEST_FIXTURES,
} from '../helpers/mock-factories';
import { Readable } from 'stream';

describe('S3FileStorageAdapter', () => {
  let adapter: S3FileStorageAdapter;
  let mockS3Service: ReturnType<typeof createMockS3Service>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let blockingDetector: ReturnType<typeof createBlockingDetector>;

  beforeEach(() => {
    mockS3Service = createMockS3Service();
    mockLogger = createMockLogger();
    blockingDetector = createBlockingDetector();

    // Create adapter instance directly (no NestJS testing utilities)
    adapter = new S3FileStorageAdapter(mockS3Service as any);

    // Replace logger with mock
    (adapter as any).logger = mockLogger;
  });

  describe('uploadStream', () => {
    it('should upload stream to S3 successfully', async () => {
      // Arrange
      const bucket = 'test-bucket';
      const key = 'test-key';
      const stream = createMockReadableStream('test data');
      const options = {
        contentType: 'application/pdf',
        metadata: { jobId: 'job-123' },
      };

      mockS3Service.uploadStream.mockResolvedValue({
        etag: '"mock-etag"',
        location: `s3://${bucket}/${key}`,
      });

      const trackEnd = blockingDetector.track('uploadStream');

      // Act
      const result = await adapter.uploadStream(bucket, key, stream, options);
      trackEnd();

      // Assert
      expect(result).toEqual({
        key,
        bucket,
        etag: '"mock-etag"',
        versionId: undefined,
        location: `s3://${bucket}/${key}`,
      });
      expect(mockS3Service.uploadStream).toHaveBeenCalledWith(key, stream, {
        contentType: 'application/pdf',
        metadata: { jobId: 'job-123' },
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Uploading stream to S3: ${bucket}/${key}`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should handle upload stream without options', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const stream = createMockReadableStream('test data');

      mockS3Service.uploadStream.mockResolvedValue({
        etag: '"mock-etag"',
        location: `s3://${bucket}/${key}`,
      });

      const result = await adapter.uploadStream(bucket, key, stream);

      expect(result.key).toBe(key);
      expect(result.bucket).toBe(bucket);
      expect(mockS3Service.uploadStream).toHaveBeenCalledWith(key, stream, {
        contentType: undefined,
        metadata: undefined,
      });
    });

    it('should propagate errors from S3 service', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const stream = createMockReadableStream('test data');
      const error = new Error('S3 upload failed');

      mockS3Service.uploadStream.mockRejectedValue(error);

      await expect(adapter.uploadStream(bucket, key, stream)).rejects.toThrow(
        'S3 upload failed',
      );
    });

    it('should validate immutability of options', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const stream = createMockReadableStream('test data');
      const options = {
        contentType: 'application/pdf',
        metadata: { jobId: 'job-123' },
      };

      const originalOptions = JSON.parse(JSON.stringify(options));

      mockS3Service.uploadStream.mockResolvedValue({
        etag: '"mock-etag"',
        location: `s3://${bucket}/${key}`,
      });

      await adapter.uploadStream(bucket, key, stream, options);

      // Validate options were not mutated
      expect(options).toEqual(originalOptions);
    });
  });

  describe('uploadBuffer', () => {
    it('should upload buffer to S3 successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const buffer = Buffer.from('test data');
      const options = {
        contentType: 'text/plain',
        metadata: { taskId: 'task-123' },
      };

      mockS3Service.uploadBuffer.mockResolvedValue({
        etag: '"buffer-etag"',
        location: `s3://${bucket}/${key}`,
      });

      const trackEnd = blockingDetector.track('uploadBuffer');
      const result = await adapter.uploadBuffer(bucket, key, buffer, options);
      trackEnd();

      expect(result).toEqual({
        key,
        bucket,
        etag: '"buffer-etag"',
        versionId: undefined,
        location: `s3://${bucket}/${key}`,
      });
      expect(mockS3Service.uploadBuffer).toHaveBeenCalledWith(key, buffer, {
        contentType: 'text/plain',
        metadata: { taskId: 'task-123' },
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Uploading buffer to S3: ${bucket}/${key} (${buffer.length} bytes)`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should not mutate buffer during upload', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const buffer = Buffer.from('test data');
      const originalBuffer = Buffer.from(buffer);

      mockS3Service.uploadBuffer.mockResolvedValue({
        etag: '"buffer-etag"',
        location: `s3://${bucket}/${key}`,
      });

      await adapter.uploadBuffer(bucket, key, buffer);

      // Validate buffer was not mutated
      expect(buffer.equals(originalBuffer)).toBe(true);
    });
  });

  describe('uploadFile', () => {
    it('should upload file to S3 successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const filePath = '/tmp/test-file.pdf';
      const options = {
        contentType: 'application/pdf',
        metadata: { originalName: 'test-file.pdf' },
      };

      mockS3Service.uploadFile.mockResolvedValue({
        etag: '"file-etag"',
        location: `s3://${bucket}/${key}`,
      });

      const trackEnd = blockingDetector.track('uploadFile');
      const result = await adapter.uploadFile(bucket, key, filePath, options);
      trackEnd();

      expect(result).toEqual({
        key,
        bucket,
        etag: '"file-etag"',
        versionId: undefined,
        location: `s3://${bucket}/${key}`,
      });
      expect(mockS3Service.uploadFile).toHaveBeenCalledWith(key, filePath, {
        contentType: 'application/pdf',
        metadata: { originalName: 'test-file.pdf' },
      });

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('downloadStream', () => {
    it('should download stream from S3 successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const mockStream = createMockReadableStream('downloaded data');

      mockS3Service.downloadStream.mockResolvedValue({
        Body: mockStream,
        ContentType: 'application/pdf',
        ContentLength: 1024,
        Metadata: { jobId: 'job-123' },
        ETag: '"download-etag"',
      });

      const trackEnd = blockingDetector.track('downloadStream');
      const result = await adapter.downloadStream(bucket, key);
      trackEnd();

      expect(result).toEqual({
        stream: mockStream,
        contentType: 'application/pdf',
        contentLength: 1024,
        metadata: { jobId: 'job-123' },
        etag: '"download-etag"',
      });
      expect(mockS3Service.downloadStream).toHaveBeenCalledWith(key);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should return stream as Readable', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const mockStream = createMockReadableStream('data');

      mockS3Service.downloadStream.mockResolvedValue({
        Body: mockStream,
        ContentType: 'text/plain',
        ContentLength: 100,
        Metadata: {},
        ETag: '"etag"',
      });

      const result = await adapter.downloadStream(bucket, key);

      expect(result.stream).toBeInstanceOf(Readable);
    });
  });

  describe('downloadFile', () => {
    it('should download file from S3 to destination path', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const destinationPath = '/tmp/downloaded-file.pdf';

      mockS3Service.downloadFile.mockResolvedValue(undefined);

      const trackEnd = blockingDetector.track('downloadFile');
      await adapter.downloadFile(bucket, key, destinationPath);
      trackEnd();

      expect(mockS3Service.downloadFile).toHaveBeenCalledWith(key, destinationPath);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Downloading file from S3: ${bucket}/${key} to ${destinationPath}`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      mockS3Service.headObject.mockResolvedValue({
        size: 1024,
        contentType: 'application/pdf',
        etag: '"exists-etag"',
      });

      const trackEnd = blockingDetector.track('fileExists');
      const exists = await adapter.fileExists(bucket, key);
      trackEnd();

      expect(exists).toBe(true);
      expect(mockS3Service.headObject).toHaveBeenCalledWith(key);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should return false when file does not exist (NotFound error)', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      const notFoundError = new Error('Not Found');
      (notFoundError as any).name = 'NotFound';

      mockS3Service.headObject.mockRejectedValue(notFoundError);

      const exists = await adapter.fileExists(bucket, key);

      expect(exists).toBe(false);
    });

    it('should return false when file does not exist (404 status)', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      const notFoundError = new Error('Not Found');
      (notFoundError as any).$metadata = { httpStatusCode: 404 };

      mockS3Service.headObject.mockRejectedValue(notFoundError);

      const exists = await adapter.fileExists(bucket, key);

      expect(exists).toBe(false);
    });

    it('should propagate non-404 errors', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      const serverError = new Error('Internal Server Error');
      (serverError as any).$metadata = { httpStatusCode: 500 };

      mockS3Service.headObject.mockRejectedValue(serverError);

      await expect(adapter.fileExists(bucket, key)).rejects.toThrow(
        'Internal Server Error',
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete single file from S3', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      mockS3Service.deleteObject.mockResolvedValue(undefined);

      const trackEnd = blockingDetector.track('deleteFile');
      await adapter.deleteFile(bucket, key);
      trackEnd();

      expect(mockS3Service.deleteObject).toHaveBeenCalledWith(key);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Deleting file from S3: ${bucket}/${key}`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('deleteFiles', () => {
    it('should delete multiple files from S3', async () => {
      const bucket = 'test-bucket';
      const keys = ['key1', 'key2', 'key3'];

      mockS3Service.deleteObjects.mockResolvedValue(undefined);

      const trackEnd = blockingDetector.track('deleteFiles');
      await adapter.deleteFiles(bucket, keys);
      trackEnd();

      expect(mockS3Service.deleteObjects).toHaveBeenCalledWith(keys);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Deleting 3 files from S3: ${bucket}`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should not mutate keys array', async () => {
      const bucket = 'test-bucket';
      const keys = ['key1', 'key2', 'key3'];
      const originalKeys = [...keys];

      mockS3Service.deleteObjects.mockResolvedValue(undefined);

      await adapter.deleteFiles(bucket, keys);

      // Validate keys array was not mutated
      expect(keys).toEqual(originalKeys);
    });
  });

  describe('getPresignedUrl', () => {
    it('should generate presigned URL', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const expiresIn = 3600;
      const expectedUrl = 'https://s3.amazonaws.com/test-bucket/test-key?signature=...';

      mockS3Service.getPresignedUrl.mockResolvedValue(expectedUrl);

      const trackEnd = blockingDetector.track('getPresignedUrl');
      const url = await adapter.getPresignedUrl(bucket, key, expiresIn);
      trackEnd();

      expect(url).toBe(expectedUrl);
      expect(mockS3Service.getPresignedUrl).toHaveBeenCalledWith(key, expiresIn);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        `Generating presigned URL for S3: ${bucket}/${key}`,
      );

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });
  });

  describe('getFileMetadata', () => {
    it('should retrieve file metadata successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      mockS3Service.headObject.mockResolvedValue({
        size: 2048,
        contentType: 'application/json',
        etag: '"metadata-etag"',
      });

      const trackEnd = blockingDetector.track('getFileMetadata');
      const metadata = await adapter.getFileMetadata(bucket, key);
      trackEnd();

      expect(metadata).toEqual({
        contentLength: 2048,
        contentType: 'application/json',
        etag: '"metadata-etag"',
      });
      expect(mockS3Service.headObject).toHaveBeenCalledWith(key);

      // Validate no blocking operations
      expect(blockingDetector.hasBlockingCalls()).toBe(false);
    });

    it('should throw error when file not found', async () => {
      const bucket = 'test-bucket';
      const key = 'non-existent-key';

      mockS3Service.headObject.mockResolvedValue(null);

      await expect(adapter.getFileMetadata(bucket, key)).rejects.toThrow(
        `File not found: ${bucket}/${key}`,
      );
    });

    it('should return metadata without optional fields', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      mockS3Service.headObject.mockResolvedValue({
        size: 1024,
        contentType: undefined,
        etag: undefined,
      });

      const metadata = await adapter.getFileMetadata(bucket, key);

      expect(metadata).toEqual({
        contentLength: 1024,
        contentType: undefined,
        etag: undefined,
      });
    });
  });

  describe('Immutability Validation', () => {
    it('should not mutate input parameters across all methods', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';
      const options = {
        contentType: 'application/pdf',
        metadata: { jobId: 'job-123' },
      };
      const originalOptions = JSON.parse(JSON.stringify(options));

      mockS3Service.uploadStream.mockResolvedValue({
        etag: '"etag"',
        location: 's3://...',
      });
      mockS3Service.uploadBuffer.mockResolvedValue({
        etag: '"etag"',
        location: 's3://...',
      });
      mockS3Service.uploadFile.mockResolvedValue({
        etag: '"etag"',
        location: 's3://...',
      });

      const stream = createMockReadableStream('data');
      const buffer = Buffer.from('data');

      await adapter.uploadStream(bucket, key, stream, options);
      expect(options).toEqual(originalOptions);

      await adapter.uploadBuffer(bucket, key, buffer, options);
      expect(options).toEqual(originalOptions);

      await adapter.uploadFile(bucket, key, '/tmp/file', options);
      expect(options).toEqual(originalOptions);
    });
  });

  describe('Blocking Operations Detection', () => {
    it('should not have any synchronous blocking operations', async () => {
      const bucket = 'test-bucket';
      const key = 'test-key';

      // Mock all S3 service methods
      mockS3Service.uploadStream.mockResolvedValue({
        etag: '"etag"',
        location: 's3://...',
      });
      mockS3Service.downloadStream.mockResolvedValue({
        Body: createMockReadableStream('data'),
        ContentType: 'text/plain',
        ContentLength: 100,
        Metadata: {},
        ETag: '"etag"',
      });
      mockS3Service.headObject.mockResolvedValue({
        size: 100,
        contentType: 'text/plain',
        etag: '"etag"',
      });
      mockS3Service.deleteObject.mockResolvedValue(undefined);
      mockS3Service.getPresignedUrl.mockResolvedValue('https://...');

      const detector = createBlockingDetector();

      // Test uploadStream
      let trackEnd = detector.track('uploadStream');
      await adapter.uploadStream(bucket, key, createMockReadableStream('data'));
      trackEnd();

      // Test downloadStream
      trackEnd = detector.track('downloadStream');
      await adapter.downloadStream(bucket, key);
      trackEnd();

      // Test fileExists
      trackEnd = detector.track('fileExists');
      await adapter.fileExists(bucket, key);
      trackEnd();

      // Test deleteFile
      trackEnd = detector.track('deleteFile');
      await adapter.deleteFile(bucket, key);
      trackEnd();

      // Test getPresignedUrl
      trackEnd = detector.track('getPresignedUrl');
      await adapter.getPresignedUrl(bucket, key, 3600);
      trackEnd();

      // Test getFileMetadata
      trackEnd = detector.track('getFileMetadata');
      await adapter.getFileMetadata(bucket, key);
      trackEnd();

      // Assert: No blocking operations detected
      expect(detector.hasBlockingCalls()).toBe(false);
      expect(detector.getBlockingCalls()).toHaveLength(0);
    });
  });
});
