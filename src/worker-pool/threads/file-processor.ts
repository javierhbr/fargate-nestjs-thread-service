import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
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
  const tempFilePath = path.join(config.tempDir, `${task.taskId}_${task.fileName}`);

  const s3Client = new S3Client({
    region: config.awsRegion,
  });

  const ctx: ProcessingContext = {
    task,
    config,
    tempFilePath,
    s3Client,
  };

  try {
    // Ensure temp directory exists
    await fs.mkdir(config.tempDir, { recursive: true });

    // Step 1: Download file
    await downloadFile(ctx);

    // Step 2: Validate file
    await validateFile(ctx);

    // Step 3: Upload to S3
    const result = await uploadToS3(ctx);

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
    // Cleanup temp file
    try {
      await fs.unlink(tempFilePath);
    } catch {
      // Ignore cleanup errors
    }
    s3Client.destroy();
  }
}

async function downloadFile(ctx: ProcessingContext): Promise<void> {
  const { task, tempFilePath, config } = ctx;

  try {
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

    // Check content length against max size
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeBytes = parseInt(contentLength, 10);
      const maxSizeBytes = config.maxFileSizeMb * 1024 * 1024;
      if (sizeBytes > maxSizeBytes) {
        const error = new Error(
          `File size ${sizeBytes} exceeds max ${maxSizeBytes}`,
        ) as Error & { code: string; retryable: boolean };
        error.code = ProcessingErrorCode.VALIDATION_FAILED;
        error.retryable = false;
        throw error;
      }
    }

    const writeStream = createWriteStream(tempFilePath);
    await pipeline(Readable.fromWeb(response.body as never), writeStream);
  } catch (error) {
    if ((error as Error & { code?: string }).code) {
      throw error;
    }
    const err = new Error(`Download failed: ${(error as Error).message}`) as Error & {
      code: string;
      retryable: boolean;
    };
    err.code = ProcessingErrorCode.DOWNLOAD_FAILED;
    err.retryable = true;
    throw err;
  }
}

async function validateFile(ctx: ProcessingContext): Promise<void> {
  const { task, tempFilePath, config } = ctx;

  try {
    const stats = await fs.stat(tempFilePath);

    // Validate file size
    const maxSizeBytes = config.maxFileSizeMb * 1024 * 1024;
    if (stats.size > maxSizeBytes) {
      const error = new Error(
        `File size ${stats.size} exceeds max ${maxSizeBytes}`,
      ) as Error & { code: string; retryable: boolean };
      error.code = ProcessingErrorCode.VALIDATION_FAILED;
      error.retryable = false;
      throw error;
    }

    // Validate checksum if provided
    if (task.checksum) {
      const fileBuffer = await fs.readFile(tempFilePath);
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      if (hash !== task.checksum) {
        const error = new Error(
          `Checksum mismatch: expected ${task.checksum}, got ${hash}`,
        ) as Error & { code: string; retryable: boolean };
        error.code = ProcessingErrorCode.VALIDATION_FAILED;
        error.retryable = true; // May be transient download issue
        throw error;
      }
    }
  } catch (error) {
    if ((error as Error & { code?: string }).code) {
      throw error;
    }
    const err = new Error(`Validation failed: ${(error as Error).message}`) as Error & {
      code: string;
      retryable: boolean;
    };
    err.code = ProcessingErrorCode.VALIDATION_FAILED;
    err.retryable = false;
    throw err;
  }
}

async function uploadToS3(
  ctx: ProcessingContext,
): Promise<{ key: string; size: number }> {
  const { task, tempFilePath, config, s3Client } = ctx;

  try {
    const stats = await fs.stat(tempFilePath);
    const fullKey = `${config.s3Prefix}${task.outputKey}`;

    // Use multipart upload for large files
    if (stats.size > 100 * 1024 * 1024) {
      // > 100MB
      const fileStream = await fs.open(tempFilePath, 'r');
      const readStream = fileStream.createReadStream();

      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: config.s3BucketName,
          Key: fullKey,
          Body: readStream,
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
      await fileStream.close();
    } else {
      const fileBuffer = await fs.readFile(tempFilePath);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.s3BucketName,
          Key: fullKey,
          Body: fileBuffer,
          Metadata: {
            jobId: task.jobId,
            taskId: task.taskId,
            originalFileName: task.fileName,
          },
        }),
      );
    }

    return {
      key: fullKey,
      size: stats.size,
    };
  } catch (error) {
    const err = new Error(`Upload failed: ${(error as Error).message}`) as Error & {
      code: string;
      retryable: boolean;
    };
    err.code = ProcessingErrorCode.UPLOAD_FAILED;
    err.retryable = true;
    throw err;
  }
}
