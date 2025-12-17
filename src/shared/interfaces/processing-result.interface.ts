export interface ProcessingResult {
  taskId: string;
  jobId: string;
  success: boolean;
  outputKey?: string;
  outputSize?: number;
  error?: ProcessingError;
  processingTimeMs: number;
  metadata?: Record<string, unknown>;
}

export interface ProcessingError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export enum ProcessingErrorCode {
  DOWNLOAD_FAILED = 'DOWNLOAD_FAILED',
  EXTRACTION_FAILED = 'EXTRACTION_FAILED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UPLOAD_FAILED = 'UPLOAD_FAILED',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN = 'UNKNOWN',
}
