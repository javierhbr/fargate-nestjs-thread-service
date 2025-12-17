import { DownloadTaskEntity } from './download-task.entity';
import { JobStateVO } from '../value-objects/job-state.vo';
import { JobStatusVO } from '../value-objects/job-status.vo';
import { ExportStatusVO } from '../value-objects/export-status.vo';

/**
 * Export Job Entity - Aggregate Root
 * Represents a user's request to export data with associated download tasks
 */
export interface ExportJobProps {
  jobId: string;
  exportId: string;
  userId: string;
  jobState: JobStateVO;
  metadata?: Record<string, unknown>;
  maxPollingAttempts?: number;
  pollingIntervalMs?: number;
  downloadTasks?: DownloadTaskEntity[];
}

export class ExportJobEntity {
  private readonly _jobId: string;
  private readonly _exportId: string;
  private readonly _userId: string;
  private readonly _jobState: JobStateVO;
  private readonly _metadata: Record<string, unknown>;
  private readonly _maxPollingAttempts: number;
  private readonly _pollingIntervalMs: number;
  private readonly _downloadTasks: DownloadTaskEntity[];

  private static readonly DEFAULT_MAX_POLLING_ATTEMPTS = 120; // 10 minutes at 5s intervals
  private static readonly DEFAULT_POLLING_INTERVAL_MS = 5000; // 5 seconds

  private constructor(props: ExportJobProps) {
    this._jobId = props.jobId;
    this._exportId = props.exportId;
    this._userId = props.userId;
    this._jobState = props.jobState;
    this._metadata = props.metadata ?? {};
    this._maxPollingAttempts = props.maxPollingAttempts ?? ExportJobEntity.DEFAULT_MAX_POLLING_ATTEMPTS;
    this._pollingIntervalMs = props.pollingIntervalMs ?? ExportJobEntity.DEFAULT_POLLING_INTERVAL_MS;
    this._downloadTasks = props.downloadTasks ?? [];
  }

  static create(props: ExportJobProps): ExportJobEntity {
    ExportJobEntity.validate(props);
    return new ExportJobEntity(props);
  }

  private static validate(props: ExportJobProps): void {
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

  get jobId(): string {
    return this._jobId;
  }

  get exportId(): string {
    return this._exportId;
  }

  get userId(): string {
    return this._userId;
  }

  get jobState(): JobStateVO {
    return this._jobState;
  }

  get status(): JobStatusVO {
    return this._jobState.status;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get maxPollingAttempts(): number {
    return this._maxPollingAttempts;
  }

  get pollingIntervalMs(): number {
    return this._pollingIntervalMs;
  }

  get downloadTasks(): ReadonlyArray<DownloadTaskEntity> {
    return this._downloadTasks;
  }

  get totalTasks(): number {
    return this._jobState.totalTasks;
  }

  get completedTasks(): number {
    return this._jobState.completedTasks;
  }

  get failedTasks(): number {
    return this._jobState.failedTasks;
  }

  get pendingTasks(): number {
    return this._jobState.pendingTasks;
  }

  get progressPercentage(): number {
    return this._jobState.progressPercentage;
  }

  isComplete(): boolean {
    return this._jobState.isComplete();
  }

  hasFailures(): boolean {
    return this._jobState.hasFailures();
  }

  allTasksSucceeded(): boolean {
    return this._jobState.allTasksSucceeded();
  }

  canStartPolling(): boolean {
    return this.status.isPending() || this.status.equals(JobStatusVO.processing());
  }

  shouldStartDownloading(exportStatus: ExportStatusVO): boolean {
    return exportStatus.isReady() && !this.isComplete();
  }

  needsPolling(exportStatus: ExportStatusVO): boolean {
    return exportStatus.isPending() && !this.isComplete();
  }

  withJobState(newJobState: JobStateVO): ExportJobEntity {
    return ExportJobEntity.create({
      ...this.toProps(),
      jobState: newJobState,
    });
  }

  transitionToPolling(): ExportJobEntity {
    const newJobState = this._jobState.withStatus(JobStatusVO.polling());
    return this.withJobState(newJobState);
  }

  transitionToDownloading(): ExportJobEntity {
    const newJobState = this._jobState.withStatus(JobStatusVO.downloading());
    return this.withJobState(newJobState);
  }

  transitionToCompleted(): ExportJobEntity {
    if (!this.isComplete()) {
      throw new Error('Cannot mark job as completed when tasks are still pending');
    }

    const newJobState = this._jobState.withStatus(JobStatusVO.completed());
    return this.withJobState(newJobState);
  }

  transitionToFailed(errorMessage: string): ExportJobEntity {
    const newJobState = this._jobState.withStatus(JobStatusVO.failed(), errorMessage);
    return this.withJobState(newJobState);
  }

  incrementCompletedTasks(): ExportJobEntity {
    const newJobState = this._jobState.withIncrementedCompleted();
    return this.withJobState(newJobState);
  }

  incrementFailedTasks(errorMessage?: string): ExportJobEntity {
    const newJobState = this._jobState.withIncrementedFailed(errorMessage);
    return this.withJobState(newJobState);
  }

  setTotalTasks(totalTasks: number): ExportJobEntity {
    const newJobState = this._jobState.withTotalTasks(totalTasks);
    return this.withJobState(newJobState);
  }

  addDownloadTask(task: DownloadTaskEntity): ExportJobEntity {
    if (task.jobId !== this._jobId) {
      throw new Error('Download task belongs to a different job');
    }

    return ExportJobEntity.create({
      ...this.toProps(),
      downloadTasks: [...this._downloadTasks, task],
    });
  }

  addDownloadTasks(tasks: DownloadTaskEntity[]): ExportJobEntity {
    const invalidTasks = tasks.filter((task) => task.jobId !== this._jobId);
    if (invalidTasks.length > 0) {
      throw new Error(`${invalidTasks.length} tasks belong to different jobs`);
    }

    return ExportJobEntity.create({
      ...this.toProps(),
      downloadTasks: [...this._downloadTasks, ...tasks],
    });
  }

  updateDownloadTask(updatedTask: DownloadTaskEntity): ExportJobEntity {
    const taskIndex = this._downloadTasks.findIndex((task) => task.taskId === updatedTask.taskId);
    if (taskIndex === -1) {
      throw new Error(`Task ${updatedTask.taskId} not found in job`);
    }

    const updatedTasks = [...this._downloadTasks];
    updatedTasks[taskIndex] = updatedTask;

    return ExportJobEntity.create({
      ...this.toProps(),
      downloadTasks: updatedTasks,
    });
  }

  getPendingDownloadTasks(): DownloadTaskEntity[] {
    return this._downloadTasks.filter((task) => task.isPending());
  }

  getFailedDownloadTasks(): DownloadTaskEntity[] {
    return this._downloadTasks.filter((task) => task.isFailed());
  }

  getRetryableDownloadTasks(): DownloadTaskEntity[] {
    return this._downloadTasks.filter((task) => task.shouldRetry());
  }

  private toProps(): ExportJobProps {
    return {
      jobId: this._jobId,
      exportId: this._exportId,
      userId: this._userId,
      jobState: this._jobState,
      metadata: this._metadata,
      maxPollingAttempts: this._maxPollingAttempts,
      pollingIntervalMs: this._pollingIntervalMs,
      downloadTasks: this._downloadTasks,
    };
  }

  toJSON() {
    return {
      jobId: this._jobId,
      exportId: this._exportId,
      userId: this._userId,
      jobState: this._jobState.toJSON(),
      metadata: this._metadata,
      maxPollingAttempts: this._maxPollingAttempts,
      pollingIntervalMs: this._pollingIntervalMs,
      downloadTasks: this._downloadTasks.map((task) => task.toJSON()),
    };
  }
}
