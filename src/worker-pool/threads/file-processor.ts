import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import * as path from 'path';
import * as crypto from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { DownloadTask } from '../../shared/interfaces/download-task.interface';
import { ProcessingErrorCode } from '../../shared/interfaces/processing-result.interface';
import { WorkerConfig } from '../interfaces/worker-message.interface';

export interface ProcessingContext {
  task: DownloadTask;
  config: WorkerConfig;
  tempFilePath: string;
  s3Client: S3Client;
}

export interface FileProcessingResult {
  success: boolean;
  outputKey?: string;
  outputSize?: number;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export async function processFile(
  task: DownloadTask,
  config: WorkerConfig,
): Promise<FileProcessingResult> {
  const s3Client = new S3Client({
    region: config.awsRegion,
  });

  const ctx: ProcessingContext = {
    task,
    config,
    tempFilePath: '', // Not used in streaming approach
    s3Client,
  };

  try {
    // Use streaming pipeline: Download → Checksum → Upload
    // No temporary file needed - single pass through data
    const result = await processFileStreaming(ctx);

    return {
      success: true,
      outputKey: result.key,
      outputSize: result.size,
    };
  } catch (error) {
    const err = error as Error & { code?: string; retryable?: boolean };
    return {
      success: false,
      error: {
        code: err.code || ProcessingErrorCode.UNKNOWN,
        message: err.message,
        retryable: err.retryable ?? true,
      },
    };
  } finally {
    s3Client.destroy();
  }
}

/**
 * Process file using streaming pipeline: Download → Checksum → Size Tracking → Upload
 * Memory efficient: No temporary files, single pass through data
 */
async function processFileStreaming(
  ctx: ProcessingContext,
): Promise<{ key: string; size: number }> {
  const { task, config, s3Client } = ctx;

  try {
    // Step 1: Download file as stream
    const response = await fetch(task.downloadUrl, {
      signal: AbortSignal.timeout(300000), // 5 minute timeout
    });

    if (!response.ok) {
      const error = new Error(
        `Download failed with status ${response.status}`,
      ) as Error & {
        code: string;
        retryable: boolean;
      };
      error.code = ProcessingErrorCode.DOWNLOAD_FAILED;
      error.retryable = response.status >= 500;
      throw error;
    }

    // Step 2: Validate file size from Content-Length header
    const contentLength = response.headers.get('content-length');
    let expectedSize = 0;

    if (contentLength) {
      expectedSize = parseInt(contentLength, 10);
      const maxSizeBytes = config.maxFileSizeMb * 1024 * 1024;
      if (expectedSize > maxSizeBytes) {
        const error = new Error(
          `File size ${expectedSize} exceeds max ${maxSizeBytes}`,
        ) as Error & { code: string; retryable: boolean };
        error.code = ProcessingErrorCode.VALIDATION_FAILED;
        error.retryable = false;
        throw error;
      }
    }

    // Step 3: Create streaming pipeline with checksum validation
    const downloadStream = Readable.fromWeb(response.body as never);
    let actualSize = 0;
    let actualChecksum: string | null = null;

    // Create checksum and size tracking streams
    const { stream: checksumStream, checksumPromise } = createChecksumStream(
      downloadStream,
      'sha256',
    );

    const sizeTrackingStream = createSizeTrackingStream((bytes) => {
      actualSize = bytes;
    });

    // Pipeline: Download → Checksum → Size Tracking
    const pipelineStream = checksumStream.pipe(sizeTrackingStream);

    // Step 4: Upload to S3 using streaming (always use Upload class for efficiency)
    const fullKey = `${config.s3Prefix}${task.outputKey}`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: config.s3BucketName,
        Key: fullKey,
        Body: pipelineStream,
        Metadata: {
          jobId: task.jobId,
          taskId: task.taskId,
          originalFileName: task.fileName,
        },
      },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();

    // Step 5: Get checksum and validate
    actualChecksum = await checksumPromise;

    if (task.checksum && actualChecksum !== task.checksum) {
      const error = new Error(
        `Checksum mismatch: expected ${task.checksum}, got ${actualChecksum}`,
      ) as Error & { code: string; retryable: boolean };
      error.code = ProcessingErrorCode.VALIDATION_FAILED;
      error.retryable = true; // May be transient download issue
      throw error;
    }

    // Step 6: Validate actual size matches expected
    if (expectedSize > 0 && actualSize !== expectedSize) {
      const error = new Error(
        `Size mismatch: expected ${expectedSize}, got ${actualSize}`,
      ) as Error & { code: string; retryable: boolean };
      error.code = ProcessingErrorCode.VALIDATION_FAILED;
      error.retryable = true;
      throw error;
    }

    return {
      key: fullKey,
      size: actualSize,
    };
  } catch (error) {
    // Re-throw errors with proper code if they don't have one
    if ((error as Error & { code?: string }).code) {
      throw error;
    }

    const err = new Error(
      `File processing failed: ${(error as Error).message}`,
    ) as Error & {
      code: string;
      retryable: boolean;
    };
    err.code = ProcessingErrorCode.UNKNOWN;
    err.retryable = true;
    throw err;
  }
}

/**
 * Create a Transform stream that calculates checksum while data passes through
 * Memory efficient: Only processes chunks in flight, no buffering
 */
function createChecksumStream(
  sourceStream: Readable,
  algorithm: string,
): { stream: Transform; checksumPromise: Promise<string> } {
  const hash = crypto.createHash(algorithm);

  let resolveChecksum: (checksum: string) => void;
  const checksumPromise = new Promise<string>((resolve) => {
    resolveChecksum = resolve;
  });

  const checksumTransform = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      try {
        // Update hash with this chunk
        hash.update(chunk);
        // Pass chunk through unchanged
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
    flush(callback) {
      try {
        // Finalize hash when stream ends
        const checksum = hash.digest('hex');
        resolveChecksum(checksum);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  // Pipe source through checksum transform
  const stream = sourceStream.pipe(checksumTransform);

  return { stream, checksumPromise };
}

/**
 * Create a Transform stream that tracks bytes processed
 * Useful for validating file size and monitoring progress
 */
function createSizeTrackingStream(onBytesProcessed: (bytes: number) => void): Transform {
  let bytesProcessed = 0;

  return new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytesProcessed += chunk.length;
      onBytesProcessed(bytesProcessed);
      // Pass chunk through unchanged
      callback(null, chunk);
    },
  });
}
