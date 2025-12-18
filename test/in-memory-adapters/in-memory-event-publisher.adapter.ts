import { Injectable } from '@nestjs/common';
import { EventPublisherPort } from '../../src/application/ports/output/event-publisher.port';
import { DomainEvent } from '../../src/domain/events/base.event';

/**
 * In-Memory Event Publisher Adapter
 * For ATDD testing - captures published events for verification
 */
@Injectable()
export class InMemoryEventPublisherAdapter implements EventPublisherPort {
  private publishedEvents: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.publishedEvents.push(event);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    this.publishedEvents.push(...events);
  }

  publishAsync(event: DomainEvent): void {
    this.publishedEvents.push(event);
  }

  // Test helper methods

  /**
   * Get all published events
   */
  getPublishedEvents(): DomainEvent[] {
    return [...this.publishedEvents];
  }

  /**
   * Get events by type
   */
  getEventsByType<T extends DomainEvent>(eventName: string): T[] {
    return this.publishedEvents.filter((event) => event.eventName === eventName) as T[];
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.publishedEvents.length;
  }

  /**
   * Get event count by type
   */
  getEventCountByType(eventName: string): number {
    return this.publishedEvents.filter((event) => event.eventName === eventName).length;
  }

  /**
   * Check if an event type was published
   */
  hasEventType(eventName: string): boolean {
    return this.publishedEvents.some((event) => event.eventName === eventName);
  }

  /**
   * Get the last published event
   */
  getLastEvent(): DomainEvent | null {
    return this.publishedEvents.length > 0
      ? this.publishedEvents[this.publishedEvents.length - 1]
      : null;
  }

  /**
   * Get the last event of a specific type
   */
  getLastEventOfType<T extends DomainEvent>(eventName: string): T | null {
    const events = this.getEventsByType<T>(eventName);
    return events.length > 0 ? events[events.length - 1] : null;
  }

  /**
   * Clear all published events
   */
  clear(): void {
    this.publishedEvents = [];
  }

  /**
   * Get events in chronological order
   */
  getEventsInOrder(): DomainEvent[] {
    return [...this.publishedEvents].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
  }

  /**
   * Find events matching a predicate
   */
  findEvents(predicate: (event: DomainEvent) => boolean): DomainEvent[] {
    return this.publishedEvents.filter(predicate);
  }
}
