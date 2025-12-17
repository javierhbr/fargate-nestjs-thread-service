import { DomainEvent } from './base.event';

/**
 * Task Dispatched Event
 * Emitted when a download task is dispatched for processing
 */
export interface TaskDispatchedEventPayload {
  taskId: string;
  jobId: string;
  fileName: string;
  downloadUrl: string;
  s3OutputKey: string;
  dispatchedTo: 'worker-pool' | 'overflow-queue';
}

export class TaskDispatchedEvent extends DomainEvent {
  constructor(public readonly payload: TaskDispatchedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'task.dispatched';
  }

  get taskId(): string {
    return this.payload.taskId;
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  get dispatchedTo(): 'worker-pool' | 'overflow-queue' {
    return this.payload.dispatchedTo;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
