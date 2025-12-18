export interface ExportJob {
  jobId: string;
  exportId: string;
  userId: string;
  requestedAt: string;
  status: ExportJobStatus;
  metadata?: Record<string, unknown>;
}

export enum ExportJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  POLLING = 'POLLING',
  DOWNLOADING = 'DOWNLOADING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface ExportJobMessage {
  jobId: string;
  exportId: string;
  userId: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  taskToken?: string;
}
