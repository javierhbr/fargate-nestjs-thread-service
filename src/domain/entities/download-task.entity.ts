import { FileMetadataVO } from '../value-objects/file-metadata.vo';

/**
 * Download Task Entity
 * Represents an individual file download within an export job
 */
export interface DownloadTaskProps {
  taskId: string;
  jobId: string;
  fileMetadata: FileMetadataVO;
  s3OutputKey: string;
  retryCount?: number;
  maxRetries?: number;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export class DownloadTaskEntity {
  private readonly _taskId: string;
  private readonly _jobId: string;
  private readonly _fileMetadata: FileMetadataVO;
  private readonly _s3OutputKey: string;
  private readonly _retryCount: number;
  private readonly _maxRetries: number;
  private readonly _status: 'pending' | 'processing' | 'completed' | 'failed';
  private readonly _errorMessage?: string;
  private readonly _createdAt: Date;
  private readonly _startedAt?: Date;
  private readonly _completedAt?: Date;

  private static readonly DEFAULT_MAX_RETRIES = 3;

  private constructor(props: DownloadTaskProps) {
    this._taskId = props.taskId;
    this._jobId = props.jobId;
    this._fileMetadata = props.fileMetadata;
    this._s3OutputKey = props.s3OutputKey;
    this._retryCount = props.retryCount ?? 0;
    this._maxRetries = props.maxRetries ?? DownloadTaskEntity.DEFAULT_MAX_RETRIES;
    this._status = props.status ?? 'pending';
    this._errorMessage = props.errorMessage;
    this._createdAt = props.createdAt ?? new Date();
    this._startedAt = props.startedAt;
    this._completedAt = props.completedAt;
  }

  static create(props: DownloadTaskProps): DownloadTaskEntity {
    DownloadTaskEntity.validate(props);
    return new DownloadTaskEntity(props);
  }

  private static validate(props: DownloadTaskProps): void {
    if (!props.taskId || props.taskId.trim().length === 0) {
      throw new Error('Task ID is required');
    }
    if (!props.jobId || props.jobId.trim().length === 0) {
      throw new Error('Job ID is required');
    }
    if (!props.fileMetadata) {
      throw new Error('File metadata is required');
    }
    if (!props.s3OutputKey || props.s3OutputKey.trim().length === 0) {
      throw new Error('S3 output key is required');
    }
    if (props.retryCount !== undefined && props.retryCount < 0) {
      throw new Error('Retry count cannot be negative');
    }
    if (props.maxRetries !== undefined && props.maxRetries < 0) {
      throw new Error('Max retries cannot be negative');
    }
  }

  get taskId(): string {
    return this._taskId;
  }

  get jobId(): string {
    return this._jobId;
  }

  get fileMetadata(): FileMetadataVO {
    return this._fileMetadata;
  }

  get s3OutputKey(): string {
    return this._s3OutputKey;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  get maxRetries(): number {
    return this._maxRetries;
  }

  get status(): 'pending' | 'processing' | 'completed' | 'failed' {
    return this._status;
  }

  get errorMessage(): string | undefined {
    return this._errorMessage;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get startedAt(): Date | undefined {
    return this._startedAt;
  }

  get completedAt(): Date | undefined {
    return this._completedAt;
  }

  get processingDuration(): number | undefined {
    if (!this._startedAt) return undefined;
    const endTime = this._completedAt ?? new Date();
    return endTime.getTime() - this._startedAt.getTime();
  }

  canRetry(): boolean {
    return this._status === 'failed' && this._retryCount < this._maxRetries;
  }

  shouldRetry(): boolean {
    return this.canRetry() && !this.isRetryLimitReached();
  }

  isRetryLimitReached(): boolean {
    return this._retryCount >= this._maxRetries;
  }

  isPending(): boolean {
    return this._status === 'pending';
  }

  isProcessing(): boolean {
    return this._status === 'processing';
  }

  isCompleted(): boolean {
    return this._status === 'completed';
  }

  isFailed(): boolean {
    return this._status === 'failed';
  }

  markAsProcessing(): DownloadTaskEntity {
    if (this._status === 'completed') {
      throw new Error('Cannot start processing a completed task');
    }

    return DownloadTaskEntity.create({
      ...this.toProps(),
      status: 'processing',
      startedAt: this._startedAt ?? new Date(),
    });
  }

  markAsCompleted(): DownloadTaskEntity {
    if (this._status !== 'processing') {
      throw new Error('Can only complete a task that is currently processing');
    }

    return DownloadTaskEntity.create({
      ...this.toProps(),
      status: 'completed',
      completedAt: new Date(),
      errorMessage: undefined,
    });
  }

  markAsFailed(errorMessage: string): DownloadTaskEntity {
    return DownloadTaskEntity.create({
      ...this.toProps(),
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    });
  }

  retry(): DownloadTaskEntity {
    if (!this.canRetry()) {
      throw new Error('Task cannot be retried');
    }

    return DownloadTaskEntity.create({
      ...this.toProps(),
      status: 'pending',
      retryCount: this._retryCount + 1,
      errorMessage: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
  }

  private toProps(): DownloadTaskProps {
    return {
      taskId: this._taskId,
      jobId: this._jobId,
      fileMetadata: this._fileMetadata,
      s3OutputKey: this._s3OutputKey,
      retryCount: this._retryCount,
      maxRetries: this._maxRetries,
      status: this._status,
      errorMessage: this._errorMessage,
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
    };
  }

  toJSON() {
    return {
      taskId: this._taskId,
      jobId: this._jobId,
      fileMetadata: this._fileMetadata.toJSON(),
      s3OutputKey: this._s3OutputKey,
      retryCount: this._retryCount,
      maxRetries: this._maxRetries,
      status: this._status,
      errorMessage: this._errorMessage,
      processingDuration: this.processingDuration,
      createdAt: this._createdAt.toISOString(),
      startedAt: this._startedAt?.toISOString(),
      completedAt: this._completedAt?.toISOString(),
    };
  }
}
