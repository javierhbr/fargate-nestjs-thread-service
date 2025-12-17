import { DownloadTaskEntity } from '../../../domain/entities/download-task.entity';

/**
 * Process Task Result
 */
export interface ProcessTaskResult {
  success: boolean;
  taskId: string;
  s3Key?: string;
  fileSize?: number;
  processingDurationMs?: number;
  errorMessage?: string;
}

/**
 * Worker Pool Statistics
 */
export interface WorkerPoolStats {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageProcessingTimeMs: number;
}

/**
 * Worker Pool Port (Driven Port)
 * Interface for distributing processing tasks to worker threads
 */
export interface WorkerPoolPort {
  /**
   * Submit a task to the worker pool for processing
   * Returns immediately if a worker is available, otherwise queues the task
   */
  submitTask(task: DownloadTaskEntity): Promise<void>;

  /**
   * Submit multiple tasks in batch
   */
  submitTasks(tasks: DownloadTaskEntity[]): Promise<void>;

  /**
   * Check if the pool has capacity for more tasks
   */
  hasCapacity(): boolean;

  /**
   * Get the number of available workers
   */
  getAvailableWorkerCount(): number;

  /**
   * Get worker pool statistics
   */
  getStats(): WorkerPoolStats;

  /**
   * Wait for all pending tasks to complete
   */
  waitForCompletion(): Promise<void>;

  /**
   * Gracefully shutdown the worker pool
   */
  shutdown(): Promise<void>;
}
