import { DomainEvent } from '../../../domain/events/base.event';

/**
 * Event Publisher Port (Driven Port)
 * Interface for publishing domain events
 */
export interface EventPublisherPort {
  /**
   * Publish a single domain event
   */
  publish(event: DomainEvent): Promise<void>;

  /**
   * Publish multiple domain events
   */
  publishBatch(events: DomainEvent[]): Promise<void>;

  /**
   * Publish an event asynchronously (fire and forget)
   */
  publishAsync(event: DomainEvent): void;
}
