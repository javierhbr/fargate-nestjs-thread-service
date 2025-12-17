import { DomainEvent } from './base.event';

/**
 * Task Completed Event
 * Emitted when a download task completes successfully
 */
export interface TaskCompletedEventPayload {
  taskId: string;
  jobId: string;
  fileName: string;
  s3OutputKey: string;
  fileSize: number;
  processingDurationMs: number;
  retryCount: number;
}

export class TaskCompletedEvent extends DomainEvent {
  constructor(public readonly payload: TaskCompletedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'task.completed';
  }

  get taskId(): string {
    return this.payload.taskId;
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
