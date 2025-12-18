import { produce } from 'immer';
import { DownloadTaskEntity } from './download-task.entity';
import { JobStateVO } from '../value-objects/job-state.vo';
import { JobStatusVO } from '../value-objects/job-status.vo';
import { ExportStatusVO } from '../value-objects/export-status.vo';

/**
 * Export Job Entity - Aggregate Root
 * Represents a user's request to export data with associated download tasks
 *
 * This uses a hybrid approach:
 * - Data stored in a plain readonly interface
 * - Methods available via namespace functions
 * - Create function returns object with both data and methods for backward compatibility
 */

/**
 * Core data structure for ExportJobEntity
 */
export interface ExportJobEntityData {
  readonly jobId: string;
  readonly exportId: string;
  readonly userId: string;
  readonly jobState: JobStateVO;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly maxPollingAttempts: number;
  readonly pollingIntervalMs: number;
  readonly downloadTasks: ReadonlyArray<DownloadTaskEntity>;
  readonly taskToken?: string;
}

/**
 * Export Job Entity with methods for backward compatibility
 */
export interface ExportJobEntity extends ExportJobEntityData {
  // Computed properties
  readonly status: JobStatusVO;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly pendingTasks: number;
  readonly progressPercentage: number;

  // Query methods
  hasTaskToken(): boolean;
  isComplete(): boolean;
  hasFailures(): boolean;
  allTasksSucceeded(): boolean;
  canStartPolling(): boolean;
  shouldStartDownloading(exportStatus: ExportStatusVO): boolean;
  needsPolling(exportStatus: ExportStatusVO): boolean;

  // Mutation methods (return new instances)
  withJobState(newJobState: JobStateVO): ExportJobEntity;
  transitionToPolling(): ExportJobEntity;
  transitionToDownloading(): ExportJobEntity;
  transitionToCompleted(): ExportJobEntity;
  transitionToFailed(errorMessage: string): ExportJobEntity;
  incrementCompletedTasks(): ExportJobEntity;
  incrementFailedTasks(errorMessage?: string): ExportJobEntity;
  setTotalTasks(totalTasks: number): ExportJobEntity;

  // Download task methods
  addDownloadTask(task: DownloadTaskEntity): ExportJobEntity;
  addDownloadTasks(tasks: DownloadTaskEntity[]): ExportJobEntity;
  updateDownloadTask(updatedTask: DownloadTaskEntity): ExportJobEntity;
  getPendingDownloadTasks(): DownloadTaskEntity[];
  getFailedDownloadTasks(): DownloadTaskEntity[];
  getRetryableDownloadTasks(): DownloadTaskEntity[];

  toJSON(): ReturnType<typeof ExportJobEntity.toJSON>;
}

/**
 * Factory and domain operations for ExportJobEntity
 * All methods are pure functions that return new immutable instances
 *
 * ESLint disable: Namespaces are acceptable for this functional pattern
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ExportJobEntity {
  const DEFAULT_MAX_POLLING_ATTEMPTS = 120; // 10 minutes at 5s intervals
  const DEFAULT_POLLING_INTERVAL_MS = 5000; // 5 seconds

  /**
   * Props for creating an ExportJobEntity
   */
  export interface CreateProps {
    jobId: string;
    exportId: string;
    userId: string;
    jobState: JobStateVO;
    metadata?: Record<string, unknown>;
    maxPollingAttempts?: number;
    pollingIntervalMs?: number;
    downloadTasks?: DownloadTaskEntity[];
    taskToken?: string;
  }

  /**
   * Create a new ExportJobEntity with validation and methods
   */
  export function create(props: CreateProps): ExportJobEntity {
    validate(props);

    const data: ExportJobEntityData = {
      jobId: props.jobId,
      exportId: props.exportId,
      userId: props.userId,
      jobState: props.jobState,
      metadata: props.metadata ?? {},
      maxPollingAttempts: props.maxPollingAttempts ?? DEFAULT_MAX_POLLING_ATTEMPTS,
      pollingIntervalMs: props.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
      downloadTasks: props.downloadTasks ?? [],
      taskToken: props.taskToken,
    };

    return attachMethods(data);
  }

  /**
   * Attach methods to entity data for backward compatibility
   * This creates an object that looks like the old class but uses Immer internally
   */
  function attachMethods(data: ExportJobEntityData): ExportJobEntity {
    return {
      ...data,

      // Computed properties
      get status() {
        return data.jobState.status;
      },
      get totalTasks() {
        return data.jobState.totalTasks;
      },
      get completedTasks() {
        return data.jobState.completedTasks;
      },
      get failedTasks() {
        return data.jobState.failedTasks;
      },
      get pendingTasks() {
        return data.jobState.pendingTasks;
      },
      get progressPercentage() {
        return data.jobState.progressPercentage;
      },

      // Query methods
      hasTaskToken: () => hasTaskToken(data),
      isComplete: () => isComplete(data),
      hasFailures: () => hasFailures(data),
      allTasksSucceeded: () => allTasksSucceeded(data),
      canStartPolling: () => canStartPolling(data),
      shouldStartDownloading: (exportStatus: ExportStatusVO) =>
        shouldStartDownloading(data, exportStatus),
      needsPolling: (exportStatus: ExportStatusVO) => needsPolling(data, exportStatus),

      // Mutation methods
      withJobState: (newJobState: JobStateVO) => withJobState(data, newJobState),
      transitionToPolling: () => transitionToPolling(data),
      transitionToDownloading: () => transitionToDownloading(data),
      transitionToCompleted: () => transitionToCompleted(data),
      transitionToFailed: (errorMessage: string) =>
        transitionToFailed(data, errorMessage),
      incrementCompletedTasks: () => incrementCompletedTasks(data),
      incrementFailedTasks: (errorMessage?: string) =>
        incrementFailedTasks(data, errorMessage),
      setTotalTasks: (totalTasksCount: number) => setTotalTasks(data, totalTasksCount),

      // Download task methods
      addDownloadTask: (task: DownloadTaskEntity) => addDownloadTask(data, task),
      addDownloadTasks: (tasks: DownloadTaskEntity[]) => addDownloadTasks(data, tasks),
      updateDownloadTask: (updatedTask: DownloadTaskEntity) =>
        updateDownloadTask(data, updatedTask),
      getPendingDownloadTasks: () => getPendingDownloadTasks(data),
      getFailedDownloadTasks: () => getFailedDownloadTasks(data),
      getRetryableDownloadTasks: () => getRetryableDownloadTasks(data),

      toJSON: () => toJSON(data),
    };
  }

  function validate(props: Partial<CreateProps>): void {
    if (!props.jobId || props.jobId.trim().length === 0) {
      throw new Error('Job ID is required');
    }
    if (!props.exportId || props.exportId.trim().length === 0) {
      throw new Error('Export ID is required');
    }
    if (!props.userId || props.userId.trim().length === 0) {
      throw new Error('User ID is required');
    }
    if (!props.jobState) {
      throw new Error('Job state is required');
    }
    if (props.maxPollingAttempts !== undefined && props.maxPollingAttempts <= 0) {
      throw new Error('Max polling attempts must be positive');
    }
    if (props.pollingIntervalMs !== undefined && props.pollingIntervalMs <= 0) {
      throw new Error('Polling interval must be positive');
    }
  }

  // ===== Pure Functions for Domain Logic =====

  export function hasTaskToken(job: ExportJobEntityData): boolean {
    return job.taskToken !== undefined && job.taskToken.length > 0;
  }

  export function isComplete(job: ExportJobEntityData): boolean {
    return job.jobState.isComplete();
  }

  export function hasFailures(job: ExportJobEntityData): boolean {
    return job.jobState.hasFailures();
  }

  export function allTasksSucceeded(job: ExportJobEntityData): boolean {
    return job.jobState.allTasksSucceeded();
  }

  export function canStartPolling(job: ExportJobEntityData): boolean {
    return (
      job.jobState.status.isPending() ||
      job.jobState.status.equals(JobStatusVO.processing())
    );
  }

  export function shouldStartDownloading(
    job: ExportJobEntityData,
    exportStatus: ExportStatusVO,
  ): boolean {
    return exportStatus.isReady() && !isComplete(job);
  }

  export function needsPolling(
    job: ExportJobEntityData,
    exportStatus: ExportStatusVO,
  ): boolean {
    return exportStatus.isPending() && !isComplete(job);
  }

  // ===== State Mutations (Return new instances via Immer) =====

  export function withJobState(
    job: ExportJobEntityData,
    newJobState: JobStateVO,
  ): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = newJobState;
    });
    return attachMethods(updated);
  }

  export function transitionToPolling(job: ExportJobEntityData): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withStatus(JobStatusVO.polling());
    });
    return attachMethods(updated);
  }

  export function transitionToDownloading(job: ExportJobEntityData): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withStatus(JobStatusVO.downloading());
    });
    return attachMethods(updated);
  }

  export function transitionToCompleted(job: ExportJobEntityData): ExportJobEntity {
    if (!isComplete(job)) {
      throw new Error('Cannot mark job as completed when tasks are still pending');
    }

    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withStatus(JobStatusVO.completed());
    });
    return attachMethods(updated);
  }

  export function transitionToFailed(
    job: ExportJobEntityData,
    errorMessage: string,
  ): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withStatus(JobStatusVO.failed(), errorMessage);
    });
    return attachMethods(updated);
  }

  export function incrementCompletedTasks(job: ExportJobEntityData): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withIncrementedCompleted();
    });
    return attachMethods(updated);
  }

  export function incrementFailedTasks(
    job: ExportJobEntityData,
    errorMessage?: string,
  ): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withIncrementedFailed(errorMessage);
    });
    return attachMethods(updated);
  }

  export function setTotalTasks(
    job: ExportJobEntityData,
    totalTasksCount: number,
  ): ExportJobEntity {
    const updated = produce(job, (draft) => {
      draft.jobState = draft.jobState.withTotalTasks(totalTasksCount);
    });
    return attachMethods(updated);
  }

  // ===== Download Task Management =====

  export function addDownloadTask(
    job: ExportJobEntityData,
    task: DownloadTaskEntity,
  ): ExportJobEntity {
    if (task.jobId !== job.jobId) {
      throw new Error('Download task belongs to a different job');
    }

    const updated = produce(job, (draft) => {
      (draft.downloadTasks as DownloadTaskEntity[]).push(task);
    });
    return attachMethods(updated);
  }

  export function addDownloadTasks(
    job: ExportJobEntityData,
    tasks: DownloadTaskEntity[],
  ): ExportJobEntity {
    const invalidTasks = tasks.filter((task) => task.jobId !== job.jobId);
    if (invalidTasks.length > 0) {
      throw new Error(`${invalidTasks.length} tasks belong to different jobs`);
    }

    const updated = produce(job, (draft) => {
      (draft.downloadTasks as DownloadTaskEntity[]).push(...tasks);
    });
    return attachMethods(updated);
  }

  export function updateDownloadTask(
    job: ExportJobEntityData,
    updatedTask: DownloadTaskEntity,
  ): ExportJobEntity {
    const taskIndex = job.downloadTasks.findIndex(
      (task) => task.taskId === updatedTask.taskId,
    );
    if (taskIndex === -1) {
      throw new Error(`Task ${updatedTask.taskId} not found in job`);
    }

    const updated = produce(job, (draft) => {
      (draft.downloadTasks as DownloadTaskEntity[])[taskIndex] = updatedTask;
    });
    return attachMethods(updated);
  }

  export function getPendingDownloadTasks(
    job: ExportJobEntityData,
  ): DownloadTaskEntity[] {
    return job.downloadTasks.filter((task) => task.isPending());
  }

  export function getFailedDownloadTasks(job: ExportJobEntityData): DownloadTaskEntity[] {
    return job.downloadTasks.filter((task) => task.isFailed());
  }

  export function getRetryableDownloadTasks(
    job: ExportJobEntityData,
  ): DownloadTaskEntity[] {
    return job.downloadTasks.filter((task) => task.shouldRetry());
  }

  // ===== Serialization =====

  export function toJSON(job: ExportJobEntityData) {
    return {
      jobId: job.jobId,
      exportId: job.exportId,
      userId: job.userId,
      jobState: job.jobState.toJSON(),
      metadata: job.metadata,
      maxPollingAttempts: job.maxPollingAttempts,
      pollingIntervalMs: job.pollingIntervalMs,
      downloadTasks: job.downloadTasks.map((task) => task.toJSON()),
      taskToken: job.taskToken,
    };
  }
}
