import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { ProcessFileCommand, ProcessFilePort, ProcessFileResult } from '../ports/input/process-file.port';
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
    this.logger.log(`Processing file task ${command.taskId} for job ${command.jobId}: ${command.fileName}`);

    try {
      // Download file
      this.logger.debug(`Downloading file from: ${command.downloadUrl}`);
      const fileBuffer = await this.downloadFile(command.downloadUrl);

      // Validate file size
      if (fileBuffer.length > this.MAX_FILE_SIZE) {
        throw new Error(`File size ${fileBuffer.length} bytes exceeds maximum ${this.MAX_FILE_SIZE} bytes`);
      }

      if (command.expectedFileSize && fileBuffer.length !== command.expectedFileSize) {
        throw new Error(
          `File size mismatch. Expected: ${command.expectedFileSize}, Actual: ${fileBuffer.length}`,
        );
      }

      // Validate checksum if provided
      if (command.checksum && command.checksumAlgorithm) {
        const actualChecksum = this.calculateChecksum(fileBuffer, command.checksumAlgorithm);
        if (actualChecksum !== command.checksum) {
          throw new Error(
            `Checksum validation failed. Expected: ${command.checksum}, Actual: ${actualChecksum}`,
          );
        }
        this.logger.debug(`Checksum validation passed: ${actualChecksum}`);
      }

      // Upload to S3
      this.logger.debug(`Uploading file to S3: ${command.s3Bucket}/${command.s3OutputKey}`);
      await this.fileStorage.uploadBuffer(command.s3Bucket, command.s3OutputKey, fileBuffer, {
        metadata: {
          taskId: command.taskId,
          jobId: command.jobId,
          originalFileName: command.fileName,
        },
      });

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

  private async downloadFile(url: string): Promise<Buffer> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private calculateChecksum(buffer: Buffer, algorithm: 'SHA-256' | 'MD5'): string {
    const hashAlgorithm = algorithm === 'SHA-256' ? 'sha256' : 'md5';
    const hash = createHash(hashAlgorithm);
    hash.update(buffer);
    return hash.digest('hex');
  }
}
