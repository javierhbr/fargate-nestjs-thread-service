import { DomainEvent } from './base.event';

/**
 * Job Completed Event
 * Emitted when all tasks in an export job have completed
 */
export interface JobCompletedEventPayload {
  jobId: string;
  exportId: string;
  userId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  success: boolean;
  durationMs: number;
}

export class JobCompletedEvent extends DomainEvent {
  constructor(public readonly payload: JobCompletedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'job.completed';
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  get exportId(): string {
    return this.payload.exportId;
  }

  get success(): boolean {
    return this.payload.success;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
