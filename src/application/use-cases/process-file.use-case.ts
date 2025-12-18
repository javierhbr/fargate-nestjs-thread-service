import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Transform, pipeline } from 'stream';
import { Readable } from 'stream';
import {
  ProcessFileCommand,
  ProcessFilePort,
  ProcessFileResult,
} from '../ports/input/process-file.port';
import { FileStoragePort } from '../ports/output/file-storage.port';
import { HttpClientService } from '../../shared/http/http-client.service';

/**
 * Process File Use Case
 * Handles downloading a file, validating it, and uploading to S3
 */
@Injectable()
export class ProcessFileUseCase implements ProcessFilePort {
  private readonly logger = new Logger(ProcessFileUseCase.name);
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

  constructor(
    private readonly fileStorage: FileStoragePort,
    private readonly httpClient: HttpClientService,
  ) {}

  async execute(command: ProcessFileCommand): Promise<ProcessFileResult> {
    const startTime = Date.now();
    this.logger.log(
      `Processing file task ${command.taskId} for job ${command.jobId}: ${command.fileName}`,
    );

    try {
      // Download file as stream with connection pooling
      this.logger.debug(`Downloading file from: ${command.downloadUrl}`);
      const response = await this.httpClient.downloadToStream(command.downloadUrl);

      if (response.statusCode !== 200) {
        throw new Error(`Failed to download file: HTTP ${response.statusCode}`);
      }

      // Validate expected file size from Content-Length header if provided
      const contentLength = response.headers['content-length'];
      let fileSize = 0;

      if (contentLength) {
        fileSize = parseInt(contentLength as string, 10);

        if (fileSize > this.MAX_FILE_SIZE) {
          throw new Error(
            `File size ${fileSize} bytes exceeds maximum ${this.MAX_FILE_SIZE} bytes`,
          );
        }

        if (command.expectedFileSize && fileSize !== command.expectedFileSize) {
          throw new Error(
            `File size mismatch. Expected: ${command.expectedFileSize}, Actual: ${fileSize}`,
          );
        }
      }

      // Create streaming pipeline: Download → Checksum → Upload to S3
      let actualChecksum: string | null = null;
      let bytesProcessed = 0;

      if (command.checksum && command.checksumAlgorithm) {
        // Stream with checksum validation
        const { stream: checksumStream, checksumPromise } = this.createChecksumStream(
          response.body,
          command.checksumAlgorithm,
        );

        // Track bytes for size validation
        const sizeTrackingStream = this.createSizeTrackingStream((bytes) => {
          bytesProcessed = bytes;
        });

        // Create pipeline: Download → SizeTracking → Checksum → Upload
        const pipelineStream = checksumStream.pipe(sizeTrackingStream);

        // Upload to S3 using streaming
        await this.fileStorage.uploadStream(
          command.s3Bucket,
          command.s3OutputKey,
          pipelineStream,
          {
            contentType: response.headers['content-type'] as string | undefined,
            metadata: {
              taskId: command.taskId,
              jobId: command.jobId,
              originalFileName: command.fileName,
            },
          },
        );

        // Wait for checksum calculation to complete
        actualChecksum = await checksumPromise;

        // Validate checksum
        if (actualChecksum !== command.checksum) {
          throw new Error(
            `Checksum validation failed. Expected: ${command.checksum}, Actual: ${actualChecksum}`,
          );
        }

        this.logger.debug(`Checksum validation passed: ${actualChecksum}`);
      } else {
        // Stream without checksum validation (faster)
        const sizeTrackingStream = this.createSizeTrackingStream((bytes) => {
          bytesProcessed = bytes;
        });

        const pipelineStream = response.body.pipe(sizeTrackingStream);

        await this.fileStorage.uploadStream(
          command.s3Bucket,
          command.s3OutputKey,
          pipelineStream,
          {
            contentType: response.headers['content-type'] as string | undefined,
            metadata: {
              taskId: command.taskId,
              jobId: command.jobId,
              originalFileName: command.fileName,
            },
          },
        );
      }

      const processingDurationMs = Date.now() - startTime;
      const finalFileSize = bytesProcessed || fileSize;

      this.logger.log(
        `Successfully processed file task ${command.taskId} in ${processingDurationMs}ms. Size: ${finalFileSize} bytes`,
      );

      return {
        success: true,
        taskId: command.taskId,
        jobId: command.jobId,
        s3Key: command.s3OutputKey,
        fileSize: finalFileSize,
        processingDurationMs,
      };
    } catch (error) {
      const processingDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(`Failed to process file task ${command.taskId}:`, error);

      return {
        success: false,
        taskId: command.taskId,
        jobId: command.jobId,
        processingDurationMs,
        errorMessage,
      };
    }
  }

  /**
   * Create a Transform stream that calculates checksum while data passes through
   * This allows single-pass streaming: Download → Checksum → Upload
   * Memory efficient: Only processes chunks in flight, no buffering
   */
  private createChecksumStream(
    sourceStream: Readable,
    algorithm: 'SHA-256' | 'MD5',
  ): { stream: Transform; checksumPromise: Promise<string> } {
    const hashAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'md5';
    const hash = createHash(hashAlgorithm);

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
  private createSizeTrackingStream(onBytesProcessed: (bytes: number) => void): Transform {
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
}
