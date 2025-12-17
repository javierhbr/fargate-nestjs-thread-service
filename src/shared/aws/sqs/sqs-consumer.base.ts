import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SqsService } from './sqs.service';
import { SqsMessageEnvelope } from '../interfaces/sqs-message.interface';
import { PinoLoggerService } from '../../logging/pino-logger.service';

// Re-export SqsMessageEnvelope for consumers
export { SqsMessageEnvelope };

export interface SqsConsumerConfig {
  queueUrl: string;
  batchSize?: number;
  pollingDelayMs?: number;
  enabled?: boolean;
}

export abstract class SqsConsumerBase<T> implements OnModuleInit, OnModuleDestroy {
  private isRunning = false;
  private isShuttingDown = false;
  private currentPollPromise: Promise<void> | null = null;

  protected readonly batchSize: number;
  protected readonly pollingDelayMs: number;
  protected readonly queueUrl: string;
  protected readonly enabled: boolean;

  constructor(
    protected readonly sqsService: SqsService,
    protected readonly logger: PinoLoggerService,
    config: SqsConsumerConfig,
  ) {
    this.queueUrl = config.queueUrl;
    this.batchSize = config.batchSize ?? 10;
    this.pollingDelayMs = config.pollingDelayMs ?? 0;
    this.enabled = config.enabled ?? true;
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      this.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.isShuttingDown = false;
    this.logger.info({ queueUrl: this.queueUrl }, 'Starting SQS consumer');
    this.poll();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info({ queueUrl: this.queueUrl }, 'Stopping SQS consumer');
    this.isShuttingDown = true;
    this.isRunning = false;

    // Wait for current poll to complete
    if (this.currentPollPromise) {
      await this.currentPollPromise;
    }
  }

  private async poll(): Promise<void> {
    while (this.isRunning && !this.isShuttingDown) {
      this.currentPollPromise = this.processBatch();
      await this.currentPollPromise;

      if (this.pollingDelayMs > 0 && !this.isShuttingDown) {
        await this.delay(this.pollingDelayMs);
      }
    }
  }

  private async processBatch(): Promise<void> {
    try {
      // Check if we should receive messages (allow subclasses to throttle)
      if (!(await this.shouldReceiveMessages())) {
        await this.delay(1000); // Wait before checking again
        return;
      }

      const messages = await this.sqsService.receiveMessages<T>(
        this.queueUrl,
        this.batchSize,
      );

      if (messages.length === 0) {
        return;
      }

      this.logger.debug(
        { count: messages.length, queueUrl: this.queueUrl },
        'Received messages',
      );

      // Process messages concurrently
      await Promise.all(messages.map((envelope) => this.handleMessage(envelope)));
    } catch (error) {
      this.logger.error({ error, queueUrl: this.queueUrl }, 'Error in polling loop');
      // Back off on error
      await this.delay(5000);
    }
  }

  private async handleMessage(envelope: SqsMessageEnvelope<T>): Promise<void> {
    const { messageId, body, receiptHandle } = envelope;

    try {
      this.logger.debug({ messageId }, 'Processing message');

      await this.processMessage(envelope);

      // Delete message on successful processing
      await this.sqsService.deleteMessage(this.queueUrl, receiptHandle);

      this.logger.debug({ messageId }, 'Message processed successfully');
    } catch (error) {
      this.logger.error({ error, messageId, body }, 'Error processing message');

      // Let the message become visible again for retry
      // Or move to DLQ if max retries exceeded
      await this.handleProcessingError(envelope, error as Error);
    }
  }

  /**
   * Override this to implement message processing logic
   */
  protected abstract processMessage(envelope: SqsMessageEnvelope<T>): Promise<void>;

  /**
   * Override this to implement custom error handling
   */
  protected async handleProcessingError(
    envelope: SqsMessageEnvelope<T>,
    error: Error,
  ): Promise<void> {
    // Default: log and let visibility timeout handle retry
    this.logger.warn(
      {
        messageId: envelope.messageId,
        receiveCount: envelope.approximateReceiveCount,
        error: error.message,
      },
      'Message processing failed, will retry',
    );
  }

  /**
   * Override this to throttle message receiving
   */
  protected async shouldReceiveMessages(): Promise<boolean> {
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
