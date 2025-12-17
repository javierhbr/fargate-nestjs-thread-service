import { DomainEvent } from './base.event';

/**
 * Task Failed Event
 * Emitted when a download task fails
 */
export interface TaskFailedEventPayload {
  taskId: string;
  jobId: string;
  fileName: string;
  errorMessage: string;
  retryCount: number;
  willRetry: boolean;
}

export class TaskFailedEvent extends DomainEvent {
  constructor(public readonly payload: TaskFailedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'task.failed';
  }

  get taskId(): string {
    return this.payload.taskId;
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  get willRetry(): boolean {
    return this.payload.willRetry;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
