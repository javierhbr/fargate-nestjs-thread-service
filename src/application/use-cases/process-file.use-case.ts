import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ProcessFileCommand,
  ProcessFilePort,
  ProcessFileResult,
} from '../ports/input/process-file.port';
import { FileStoragePort } from '../ports/output/file-storage.port';

/**
 * Process File Use Case
 * Handles downloading a file, validating it, and uploading to S3
 */
@Injectable()
export class ProcessFileUseCase implements ProcessFilePort {
  private readonly logger = new Logger(ProcessFileUseCase.name);
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

  constructor(private readonly fileStorage: FileStoragePort) {}

  async execute(command: ProcessFileCommand): Promise<ProcessFileResult> {
    const startTime = Date.now();
    this.logger.log(
      `Processing file task ${command.taskId} for job ${command.jobId}: ${command.fileName}`,
    );

    try {
      // Download file
      this.logger.debug(`Downloading file from: ${command.downloadUrl}`);
      const fileBuffer = await this.downloadFile(command.downloadUrl);

      // Validate file size
      if (fileBuffer.length > this.MAX_FILE_SIZE) {
        throw new Error(
          `File size ${fileBuffer.length} bytes exceeds maximum ${this.MAX_FILE_SIZE} bytes`,
        );
      }

      if (command.expectedFileSize && fileBuffer.length !== command.expectedFileSize) {
        throw new Error(
          `File size mismatch. Expected: ${command.expectedFileSize}, Actual: ${fileBuffer.length}`,
        );
      }

      // Validate checksum if provided
      if (command.checksum && command.checksumAlgorithm) {
        const actualChecksum = await this.calculateChecksumAsync(
          fileBuffer,
          command.checksumAlgorithm,
        );
        if (actualChecksum !== command.checksum) {
          throw new Error(
            `Checksum validation failed. Expected: ${command.checksum}, Actual: ${actualChecksum}`,
          );
        }
        this.logger.debug(`Checksum validation passed: ${actualChecksum}`);
      }

      // Upload to S3
      this.logger.debug(
        `Uploading file to S3: ${command.s3Bucket}/${command.s3OutputKey}`,
      );
      await this.fileStorage.uploadBuffer(
        command.s3Bucket,
        command.s3OutputKey,
        fileBuffer,
        {
          metadata: {
            taskId: command.taskId,
            jobId: command.jobId,
            originalFileName: command.fileName,
          },
        },
      );

      const processingDurationMs = Date.now() - startTime;

      this.logger.log(
        `Successfully processed file task ${command.taskId} in ${processingDurationMs}ms. Size: ${fileBuffer.length} bytes`,
      );

      return {
        success: true,
        taskId: command.taskId,
        jobId: command.jobId,
        s3Key: command.s3OutputKey,
        fileSize: fileBuffer.length,
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
   * Download file with streaming to avoid blocking event loop on large files
   * Uses chunked buffer accumulation with periodic yields
   */
  private async downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const chunks: Buffer[] = [];
    const reader = response.body.getReader();

    try {
      let chunkCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(Buffer.from(value));
        chunkCount++;

        // Yield to event loop every 10 chunks to prevent blocking
        // Each chunk is typically 16KB-64KB, so this yields every ~160KB-640KB
        if (chunkCount % 10 === 0) {
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate all chunks into final buffer
    // For very large files, yield before final concatenation
    if (chunks.length > 100) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Calculate checksum asynchronously with chunked processing
   * Prevents event loop blocking on large files (up to 5GB)
   */
  private async calculateChecksumAsync(
    buffer: Buffer,
    algorithm: 'SHA-256' | 'MD5',
  ): Promise<string> {
    const hashAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'md5';
    const hash = createHash(hashAlgorithm);

    // Process in 1MB chunks to allow event loop to breathe
    const CHUNK_SIZE = 1024 * 1024; // 1MB

    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      const chunk = buffer.slice(i, Math.min(i + CHUNK_SIZE, buffer.length));
      hash.update(chunk);

      // Yield to event loop after each chunk
      // For a 5GB file, this yields ~5000 times, preventing any long blocking
      if (i + CHUNK_SIZE < buffer.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    return hash.digest('hex');
  }

  /**
   * Legacy synchronous checksum calculation (kept for backward compatibility)
   * @deprecated Use calculateChecksumAsync for large files
   */
  private calculateChecksum(buffer: Buffer, algorithm: 'SHA-256' | 'MD5'): string {
    const hashAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'md5';
    const hash = createHash(hashAlgorithm);
    hash.update(buffer);
    return hash.digest('hex');
  }
}
