export interface DownloadTask {
  taskId: string;
  jobId: string;
  exportId: string;
  downloadUrl: string;
  fileName: string;
  fileSize?: number;
  checksum?: string;
  outputKey: string;
  metadata?: Record<string, unknown>;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
}

export interface DownloadTaskMessage {
  taskId: string;
  jobId: string;
  exportId: string;
  downloadUrl: string;
  fileName: string;
  fileSize?: number;
  checksum?: string;
  outputKey: string;
  metadata?: Record<string, unknown>;
}
