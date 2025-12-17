/**
 * Process File Command
 */
export interface ProcessFileCommand {
  taskId: string;
  jobId: string;
  downloadUrl: string;
  fileName: string;
  s3OutputKey: string;
  s3Bucket: string;
  expectedFileSize?: number;
  checksum?: string;
  checksumAlgorithm?: 'SHA-256' | 'MD5';
}

/**
 * Process File Result
 */
export interface ProcessFileResult {
  success: boolean;
  taskId: string;
  jobId: string;
  s3Key?: string;
  fileSize?: number;
  processingDurationMs: number;
  errorMessage?: string;
}

/**
 * Process File Port (Driving Port / Use Case Interface)
 * Handles downloading a file, validating it, and uploading to S3
 */
export interface ProcessFilePort {
  /**
   * Execute the process file use case
   */
  execute(command: ProcessFileCommand): Promise<ProcessFileResult>;
}
