import { vi } from 'vitest';
import { Readable } from 'stream';

/**
 * Mock Factories for AWS SDK Clients and Common Dependencies
 * Used across all adapter unit tests
 */

/**
 * Create a mock S3Client
 */
export function createMockS3Client() {
  return {
    send: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Create a mock DynamoDB Client
 */
export function createMockDynamoDBClient() {
  return {
    send: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Create a mock SQS Client
 */
export function createMockSQSClient() {
  return {
    send: vi.fn(),
    deleteMessage: vi.fn(),
    receiveMessage: vi.fn(),
    sendMessage: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Create a mock Step Functions Client
 */
export function createMockSFNClient() {
  return {
    send: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Create a mock Logger (Pino/NestJS compatible)
 */
export function createMockLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    info: vi.fn(),
  };
}

/**
 * Create a mock DynamoDBService
 */
export function createMockDynamoDBService() {
  return {
    putItem: vi.fn(),
    getItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    query: vi.fn(),
    scan: vi.fn(),
    createJobState: vi.fn(),
    getJobState: vi.fn(),
    updateJobStatus: vi.fn(),
    incrementTaskCount: vi.fn(),
    setTotalTasks: vi.fn(),
    deleteJobState: vi.fn(),
    getJobsByStatus: vi.fn(),
  };
}

/**
 * Create a mock S3Service
 */
export function createMockS3Service() {
  return {
    uploadStream: vi.fn(),
    uploadBuffer: vi.fn(),
    uploadFile: vi.fn(),
    downloadStream: vi.fn(),
    downloadBuffer: vi.fn(),
    downloadFile: vi.fn(),
    deleteObject: vi.fn(),
    deleteObjects: vi.fn(),
    headObject: vi.fn(),
    getPresignedUrl: vi.fn(),
    listObjects: vi.fn(),
  };
}

/**
 * Create a readable stream from string data
 */
export function createMockReadableStream(data: string): Readable {
  const stream = new Readable();
  stream.push(data);
  stream.push(null);
  return stream;
}

/**
 * Create a mock Upload class instance
 */
export function createMockUpload() {
  return {
    done: vi.fn().mockResolvedValue({
      Location: 's3://bucket/key',
      ETag: '"mock-etag"',
      Bucket: 'bucket',
      Key: 'key',
    }),
    abort: vi.fn(),
    on: vi.fn(),
  };
}

/**
 * Test data fixtures
 */
export const TEST_FIXTURES = {
  exportJob: {
    id: 'job-123',
    status: 'PENDING' as const,
    exportId: 'export-123',
    requestedBy: 'user-123',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    totalFiles: 10,
    processedFiles: 0,
    failedFiles: 0,
    totalBytes: 1000000,
    processedBytes: 0,
  },
  downloadTask: {
    jobId: 'job-123',
    taskId: 'task-123',
    downloadUrl: 'https://example.com/file.pdf',
    fileName: 'file.pdf',
    outputKey: 'exports/job-123/file.pdf',
    checksum: 'abc123',
    fileSize: 1024,
  },
  s3Object: {
    Key: 'exports/job-123/file.pdf',
    Size: 1024,
    LastModified: new Date('2025-01-01T00:00:00Z'),
    ETag: '"mock-etag"',
  },
};

/**
 * Helper to wait for async operations
 */
export async function waitForAsync(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock JobStateRepositoryPort
 */
export function createMockJobRepository() {
  return {
    save: vi.fn(),
    findById: vi.fn(),
    updateJobState: vi.fn(),
    incrementCompletedTasks: vi.fn(),
    incrementFailedTasks: vi.fn(),
    setTotalTasks: vi.fn(),
    delete: vi.fn(),
    findByStatus: vi.fn(),
  };
}

/**
 * Create a mock ExportApiPort
 */
export function createMockExportApi() {
  return {
    getExportStatus: vi.fn(),
    startExport: vi.fn(),
    cancelExport: vi.fn(),
  };
}

/**
 * Create a mock EventPublisherPort
 */
export function createMockEventPublisher() {
  return {
    publish: vi.fn(),
    publishBatch: vi.fn(),
  };
}

/**
 * Create a mock FileStoragePort
 */
export function createMockFileStorage() {
  return {
    uploadStream: vi.fn(),
    uploadBuffer: vi.fn(),
    uploadFile: vi.fn(),
    downloadStream: vi.fn(),
    downloadFile: vi.fn(),
    fileExists: vi.fn(),
    deleteFile: vi.fn(),
    deleteFiles: vi.fn(),
    getPresignedUrl: vi.fn(),
    getFileMetadata: vi.fn(),
  };
}

/**
 * Create a mock MessageQueuePort
 */
export function createMockMessageQueue() {
  return {
    sendMessage: vi.fn(),
    sendMessageBatch: vi.fn(),
    receiveMessages: vi.fn(),
    deleteMessage: vi.fn(),
  };
}

/**
 * Create a mock HttpClientService
 */
export function createMockHttpClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    downloadToStream: vi.fn(),
    downloadToBuffer: vi.fn(),
  };
}

/**
 * Create a mock StepFunctionsPort
 */
export function createMockStepFunctions() {
  return {
    sendTaskSuccess: vi.fn(),
    sendTaskFailure: vi.fn(),
    sendTaskHeartbeat: vi.fn(),
  };
}

/**
 * Helper to create a mock that tracks blocking operations
 */
export function createBlockingDetector() {
  const blockingCalls: Array<{ operation: string; duration: number }> = [];

  return {
    track: (operation: string) => {
      const start = Date.now();
      return () => {
        const duration = Date.now() - start;
        if (duration > 10) {
          // More than 10ms is considered blocking
          blockingCalls.push({ operation, duration });
        }
      };
    },
    getBlockingCalls: () => blockingCalls,
    hasBlockingCalls: () => blockingCalls.length > 0,
  };
}
