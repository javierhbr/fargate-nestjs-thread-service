import { Injectable, Logger } from '@nestjs/common';
import { EventPublisherPort } from '../../../application/ports/output/event-publisher.port';
import { DomainEvent } from '../../../domain/events/base.event';

/**
 * Console Event Publisher Adapter (Simple Implementation)
 * Implements EventPublisherPort by logging events
 *
 * In production, this should be replaced with:
 * - EventBridge
 * - SNS/SQS
 * - Custom event bus
 */
@Injectable()
export class ConsoleEventPublisherAdapter implements EventPublisherPort {
  private readonly logger = new Logger(ConsoleEventPublisherAdapter.name);

  async publish(event: DomainEvent): Promise<void> {
    this.logger.log(`[EVENT] ${event.eventName}`, event.toJSON());
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  publishAsync(event: DomainEvent): void {
    // Fire and forget
    this.publish(event).catch((error) => {
      this.logger.error(`Failed to publish event ${event.eventName}:`, error);
    });
  }
}
