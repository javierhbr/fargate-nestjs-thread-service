import { DownloadTaskEntity } from '../../../domain/entities/download-task.entity';

/**
 * Dispatch Download Tasks Command
 */
export interface DispatchDownloadTasksCommand {
  jobId: string;
  downloadUrls: string[];
}

/**
 * Task Dispatch Info
 */
export interface TaskDispatchInfo {
  task: DownloadTaskEntity;
  dispatchedTo: 'worker-pool' | 'overflow-queue';
}

/**
 * Dispatch Download Tasks Result
 */
export interface DispatchDownloadTasksResult {
  jobId: string;
  totalTasksDispatched: number;
  tasksToWorkerPool: number;
  tasksToOverflowQueue: number;
  dispatchedTasks: TaskDispatchInfo[];
}

/**
 * Dispatch Download Tasks Port (Driving Port / Use Case Interface)
 * Handles distributing download tasks to workers or overflow queue
 */
export interface DispatchDownloadTasksPort {
  /**
   * Execute the dispatch download tasks use case
   */
  execute(command: DispatchDownloadTasksCommand): Promise<DispatchDownloadTasksResult>;
}
