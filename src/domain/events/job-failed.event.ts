import { DomainEvent } from './base.event';

/**
 * Job Failed Event
 * Emitted when an export job fails completely
 */
export interface JobFailedEventPayload {
  jobId: string;
  exportId: string;
  userId: string;
  errorMessage: string;
  failureReason: 'export_failed' | 'export_expired' | 'polling_timeout' | 'all_tasks_failed';
}

export class JobFailedEvent extends DomainEvent {
  constructor(public readonly payload: JobFailedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'job.failed';
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  get exportId(): string {
    return this.payload.exportId;
  }

  get failureReason(): string {
    return this.payload.failureReason;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
