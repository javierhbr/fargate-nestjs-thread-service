import { vi } from 'vitest';
import { Readable, Writable, Transform } from 'stream';
import { EventEmitter } from 'events';

/**
 * Mock Factories for Worker Pool Testing
 * Provides mocks for Worker threads, streams, S3 client, and file processor
 */

/**
 * Create a mock Worker class instance
 */
export function createMockWorker(workerId: number = 1) {
  const worker = new EventEmitter() as any;

  worker.threadId = workerId;
  worker.postMessage = vi.fn();
  worker.terminate = vi.fn().mockResolvedValue(0);
  worker.ref = vi.fn();
  worker.unref = vi.fn();

  // Helper to simulate worker messages
  worker.simulateMessage = (message: any) => {
    worker.emit('message', message);
  };

  // Helper to simulate worker errors
  worker.simulateError = (error: Error) => {
    worker.emit('error', error);
  };

  // Helper to simulate worker exit
  worker.simulateExit = (code: number) => {
    worker.emit('exit', code);
  };

  return worker;
}

/**
 * Create a mock S3 client for worker pool
 */
export function createMockS3Client() {
  return {
    send: vi.fn(),
    destroy: vi.fn(),
  };
}

/**
 * Create a mock Upload class instance for S3 streaming
 */
export function createMockUpload() {
  const upload = new EventEmitter() as any;

  upload.done = vi.fn().mockResolvedValue({
    Location: 's3://test-bucket/test-key',
    ETag: '"mock-etag-123"',
    Bucket: 'test-bucket',
    Key: 'test-key',
  });

  upload.abort = vi.fn().mockResolvedValue(undefined);
  upload.on = vi.fn((event: string, handler: Function) => {
    upload.addEventListener(event, handler);
    return upload;
  });

  return upload;
}

/**
 * Create a mock readable stream with configurable data
 */
export function createMockReadableStream(data: string | Buffer = 'test data'): Readable {
  const stream = new Readable();
  stream.push(data);
  stream.push(null);
  return stream;
}

/**
 * Create a mock readable stream that errors
 */
export function createErrorStream(errorMessage: string = 'Stream error'): Readable {
  const stream = new Readable({
    read() {
      process.nextTick(() => {
        this.emit('error', new Error(errorMessage));
      });
    },
  });
  return stream;
}

/**
 * Create a mock writable stream that tracks written data
 */
export function createMockWritableStream(): Writable & { getData: () => Buffer } {
  const chunks: Buffer[] = [];

  const stream = new Writable({
    write(chunk: any, encoding: any, callback: any) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  }) as any;

  stream.getData = () => Buffer.concat(chunks);

  return stream;
}

/**
 * Create a mock transform stream for testing pipelines
 */
export function createMockTransformStream(): Transform {
  return new Transform({
    transform(chunk: any, encoding: any, callback: any) {
      this.push(chunk);
      callback();
    },
  });
}

/**
 * Create a mock file processor
 */
export function createMockFileProcessor() {
  return {
    processFile: vi.fn().mockResolvedValue({
      success: true,
      s3Key: 'test-output-key',
      fileSize: 1024,
      checksum: 'abc123',
      processingTimeMs: 100,
    }),
  };
}

/**
 * Create a mock logger (Pino/NestJS compatible)
 */
export function createMockLogger() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    info: vi.fn(),
    setContext: vi.fn(),
  };
}

/**
 * Create a mock HTTP response for file downloads
 */
export function createMockHttpResponse(data: string = 'test file content') {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-length': data.length.toString(),
    },
    body: createMockReadableStream(data),
  };
}

/**
 * Create a mock HTTP client for downloads
 */
export function createMockHttpClient() {
  return {
    get: vi.fn(),
    downloadToStream: vi.fn().mockResolvedValue(createMockHttpResponse()),
  };
}

/**
 * Helper to create a blocking detector
 * Tracks operations that take too long (>10ms considered blocking)
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
    reset: () => {
      blockingCalls.length = 0;
    },
  };
}

/**
 * Helper to wait for async operations
 */
export async function waitForAsync(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to wait for next tick
 */
export async function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => process.nextTick(resolve));
}

/**
 * Test data fixtures for worker pool
 */
export const TEST_FIXTURES = {
  downloadTask: {
    taskId: 'task-123',
    jobId: 'job-123',
    downloadUrl: 'https://example.com/file.pdf',
    fileName: 'file.pdf',
    s3Bucket: 'test-bucket',
    s3OutputKey: 'exports/job-123/file.pdf',
    checksum: '60f5237ed4049f0382661ef009d2bc42e48c3ceb3edb6600f7024e7ab3b838f3', // SHA-256 of 'test file content'
    checksumAlgorithm: 'SHA-256' as const,
    expectedFileSize: 1024,
  },
  workerConfig: {
    s3Bucket: 'test-bucket',
    downloadTimeout: 30000,
    uploadTimeout: 30000,
    checksumAlgorithm: 'SHA-256' as const,
  },
  workerMessage: {
    processTask: {
      type: 'PROCESS_TASK' as const,
      payload: {
        taskId: 'task-123',
        task: {
          taskId: 'task-123',
          jobId: 'job-123',
          downloadUrl: 'https://example.com/file.pdf',
          fileName: 'file.pdf',
          s3Bucket: 'test-bucket',
          s3OutputKey: 'exports/job-123/file.pdf',
        },
      },
    },
    healthCheck: {
      type: 'HEALTH_CHECK' as const,
      payload: {},
    },
    shutdown: {
      type: 'SHUTDOWN' as const,
      payload: {},
    },
    taskCompleted: {
      type: 'TASK_COMPLETED' as const,
      payload: {
        taskId: 'task-123',
        result: {
          success: true,
          s3Key: 'exports/job-123/file.pdf',
          fileSize: 1024,
          checksum: 'abc123',
        },
      },
    },
    taskFailed: {
      type: 'TASK_FAILED' as const,
      payload: {
        taskId: 'task-123',
        error: {
          message: 'Download failed',
          stack: 'Error stack',
        },
      },
    },
    healthResponse: {
      type: 'HEALTH_RESPONSE' as const,
      payload: {
        timestamp: Date.now(),
        memoryUsage: process.memoryUsage(),
      },
    },
  },
};
