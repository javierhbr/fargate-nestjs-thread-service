import { DownloadTask } from '../../shared/interfaces/download-task.interface';

export enum WorkerMessageType {
  PROCESS_TASK = 'PROCESS_TASK',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_FAILED = 'TASK_FAILED',
  SHUTDOWN = 'SHUTDOWN',
  HEALTH_CHECK = 'HEALTH_CHECK',
  HEALTH_RESPONSE = 'HEALTH_RESPONSE',
}

export interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload: T;
  timestamp: number;
}

export interface ProcessTaskPayload {
  task: DownloadTask;
  config: WorkerConfig;
}

export interface WorkerConfig {
  tempDir: string;
  maxFileSizeMb: number;
  s3BucketName: string;
  s3Prefix: string;
  awsRegion: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  jobId: string;
  outputKey: string;
  outputSize: number;
  processingTimeMs: number;
}

export interface TaskFailedPayload {
  taskId: string;
  jobId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  processingTimeMs: number;
}

export interface HealthResponsePayload {
  workerId: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
}
