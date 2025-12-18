import { produce } from 'immer';
import { FileMetadataVO } from '../value-objects/file-metadata.vo';

/**
 * Download Task Entity - Represents an individual file download within an export job
 *
 * Status Transitions:
 * PENDING → PROCESSING → COMPLETED (success path)
 * PENDING → PROCESSING → FAILED (error path)
 * FAILED → PENDING (retry path, only if retryable)
 *
 * This uses a hybrid approach:
 * - Data stored in a plain readonly interface
 * - Methods available via namespace functions
 * - Create function returns object with both data and methods for backward compatibility
 */

/**
 * Core data structure for DownloadTaskEntity
 */
export interface DownloadTaskEntityData {
  readonly taskId: string;
  readonly jobId: string;
  readonly fileMetadata: FileMetadataVO;
  readonly s3OutputKey: string;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed';
  readonly errorMessage?: string;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly s3UploadedKey?: string;
  readonly uploadedSizeBytes?: number;
}

/**
 * Props interface for backward compatibility
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
  s3UploadedKey?: string;
  uploadedSizeBytes?: number;
}

/**
 * Download Task Entity with methods for backward compatibility
 */
export interface DownloadTaskEntity extends DownloadTaskEntityData {
  // Computed properties
  readonly processingDuration: number | undefined;

  // Query methods
  canRetry(): boolean;
  shouldRetry(): boolean;
  isRetryLimitReached(): boolean;
  isPending(): boolean;
  isProcessing(): boolean;
  isCompleted(): boolean;
  isFailed(): boolean;

  // Mutation methods (return new instances)
  markAsProcessing(): DownloadTaskEntity;
  markAsCompleted(s3UploadedKey?: string, uploadedSizeBytes?: number): DownloadTaskEntity;
  markAsFailed(errorMessage: string): DownloadTaskEntity;
  retry(): DownloadTaskEntity;

  toJSON(): ReturnType<typeof DownloadTaskEntity.toJSON>;
}

/**
 * Factory and domain operations for DownloadTaskEntity
 * All methods are pure functions that return new immutable instances
 *
 * ESLint disable: Namespaces are acceptable for this functional pattern
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace DownloadTaskEntity {
  const DEFAULT_MAX_RETRIES = 3;

  /**
   * Props for creating a DownloadTaskEntity
   */
  export interface CreateProps {
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
    s3UploadedKey?: string;
    uploadedSizeBytes?: number;
  }

  /**
   * Create a new DownloadTaskEntity with validation and methods
   */
  export function create(props: CreateProps): DownloadTaskEntity {
    validate(props);

    const data: DownloadTaskEntityData = {
      taskId: props.taskId,
      jobId: props.jobId,
      fileMetadata: props.fileMetadata,
      s3OutputKey: props.s3OutputKey,
      retryCount: props.retryCount ?? 0,
      maxRetries: props.maxRetries ?? DEFAULT_MAX_RETRIES,
      status: props.status ?? 'pending',
      errorMessage: props.errorMessage,
      createdAt: props.createdAt ?? new Date(),
      startedAt: props.startedAt,
      completedAt: props.completedAt,
      s3UploadedKey: props.s3UploadedKey,
      uploadedSizeBytes: props.uploadedSizeBytes,
    };

    return attachMethods(data);
  }

  /**
   * Attach methods to entity data for backward compatibility
   * This creates an object that looks like the old class but uses Immer internally
   */
  function attachMethods(data: DownloadTaskEntityData): DownloadTaskEntity {
    return {
      ...data,

      // Computed properties
      get processingDuration() {
        return getProcessingDuration(data);
      },

      // Query methods
      canRetry: () => canRetry(data),
      shouldRetry: () => shouldRetry(data),
      isRetryLimitReached: () => isRetryLimitReached(data),
      isPending: () => isPending(data),
      isProcessing: () => isProcessing(data),
      isCompleted: () => isCompleted(data),
      isFailed: () => isFailed(data),

      // Mutation methods
      markAsProcessing: () => markAsProcessing(data),
      markAsCompleted: (s3UploadedKey?: string, uploadedSizeBytes?: number) =>
        markAsCompleted(data, s3UploadedKey, uploadedSizeBytes),
      markAsFailed: (errorMessage: string) => markAsFailed(data, errorMessage),
      retry: () => retry(data),

      toJSON: () => toJSON(data),
    };
  }

  function validate(props: Partial<CreateProps>): void {
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

  // ===== Pure Functions for Computed Properties =====

  export function getProcessingDuration(
    task: DownloadTaskEntityData,
  ): number | undefined {
    if (!task.startedAt) return undefined;
    const endTime = task.completedAt ?? new Date();
    return endTime.getTime() - task.startedAt.getTime();
  }

  // ===== Pure Functions for Query Logic =====

  export function canRetry(task: DownloadTaskEntityData): boolean {
    return task.status === 'failed' && task.retryCount < task.maxRetries;
  }

  export function shouldRetry(task: DownloadTaskEntityData): boolean {
    return canRetry(task) && !isRetryLimitReached(task);
  }

  export function isRetryLimitReached(task: DownloadTaskEntityData): boolean {
    return task.retryCount >= task.maxRetries;
  }

  export function isPending(task: DownloadTaskEntityData): boolean {
    return task.status === 'pending';
  }

  export function isProcessing(task: DownloadTaskEntityData): boolean {
    return task.status === 'processing';
  }

  export function isCompleted(task: DownloadTaskEntityData): boolean {
    return task.status === 'completed';
  }

  export function isFailed(task: DownloadTaskEntityData): boolean {
    return task.status === 'failed';
  }

  // ===== State Mutations (Return new instances via Immer) =====

  export function markAsProcessing(task: DownloadTaskEntityData): DownloadTaskEntity {
    if (task.status === 'completed') {
      throw new Error('Cannot start processing a completed task');
    }

    const updated = produce(task, (draft) => {
      draft.status = 'processing';
      draft.startedAt = draft.startedAt ?? new Date();
    });
    return attachMethods(updated);
  }

  export function markAsCompleted(
    task: DownloadTaskEntityData,
    s3UploadedKey?: string,
    uploadedSizeBytes?: number,
  ): DownloadTaskEntity {
    if (task.status !== 'processing') {
      throw new Error('Can only complete a task that is currently processing');
    }

    const updated = produce(task, (draft) => {
      draft.status = 'completed';
      draft.completedAt = new Date();
      draft.errorMessage = undefined;
      if (s3UploadedKey !== undefined) {
        draft.s3UploadedKey = s3UploadedKey;
      }
      if (uploadedSizeBytes !== undefined) {
        draft.uploadedSizeBytes = uploadedSizeBytes;
      }
    });
    return attachMethods(updated);
  }

  export function markAsFailed(
    task: DownloadTaskEntityData,
    errorMessage: string,
  ): DownloadTaskEntity {
    const updated = produce(task, (draft) => {
      draft.status = 'failed';
      draft.errorMessage = errorMessage;
      draft.completedAt = new Date();
    });
    return attachMethods(updated);
  }

  export function retry(task: DownloadTaskEntityData): DownloadTaskEntity {
    if (!canRetry(task)) {
      throw new Error('Task cannot be retried');
    }

    const updated = produce(task, (draft) => {
      draft.status = 'pending';
      draft.retryCount = draft.retryCount + 1;
      draft.errorMessage = undefined;
      draft.startedAt = undefined;
      draft.completedAt = undefined;
    });
    return attachMethods(updated);
  }

  // ===== Serialization =====

  export function toJSON(task: DownloadTaskEntityData) {
    return {
      taskId: task.taskId,
      jobId: task.jobId,
      fileMetadata: task.fileMetadata.toJSON(),
      s3OutputKey: task.s3OutputKey,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      status: task.status,
      errorMessage: task.errorMessage,
      processingDuration: getProcessingDuration(task),
      createdAt: task.createdAt.toISOString(),
      startedAt: task.startedAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
      s3UploadedKey: task.s3UploadedKey,
      uploadedSizeBytes: task.uploadedSizeBytes,
    };
  }
}
