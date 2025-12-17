export interface ExportApiResponse {
  exportId: string;
  status: ExportApiStatus;
  downloadUrls?: DownloadUrlInfo[];
  error?: {
    code: string;
    message: string;
  };
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

export enum ExportApiStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

export interface DownloadUrlInfo {
  url: string;
  fileName: string;
  fileSize?: number;
  checksum?: string;
  expiresAt?: string;
}

export interface ExportApiStartRequest {
  exportId: string;
  userId: string;
  parameters?: Record<string, unknown>;
}

export interface ExportApiStartResponse {
  exportId: string;
  status: ExportApiStatus;
  estimatedCompletionTime?: string;
}
