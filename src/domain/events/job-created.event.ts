import { DomainEvent } from './base.event';

/**
 * Job Created Event
 * Emitted when a new export job is created
 */
export interface JobCreatedEventPayload {
  jobId: string;
  exportId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

export class JobCreatedEvent extends DomainEvent {
  constructor(public readonly payload: JobCreatedEventPayload) {
    super();
  }

  get eventName(): string {
    return 'job.created';
  }

  get jobId(): string {
    return this.payload.jobId;
  }

  get exportId(): string {
    return this.payload.exportId;
  }

  get userId(): string {
    return this.payload.userId;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      payload: this.payload,
    };
  }
}
