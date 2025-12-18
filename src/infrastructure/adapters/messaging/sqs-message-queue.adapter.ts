import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SqsService } from '@ssut/nestjs-sqs';
import { AppConfig } from '../../../config/configuration';
import {
  MessageQueuePort,
  QueueMessage,
  SendMessageOptions,
} from '../../../application/ports/output/message-queue.port';

/**
 * SQS Message Queue Adapter
 * Implements MessageQueuePort using @ssut/nestjs-sqs
 */
@Injectable()
export class SqsMessageQueueAdapter implements MessageQueuePort {
  private readonly logger = new Logger(SqsMessageQueueAdapter.name);

  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: ConfigService<AppConfig>,
  ) {}

  /**
   * Map queue URL to producer name
   */
  private getProducerName(queueUrl: string): string {
    const sqsConfig = this.configService.get('sqs', { infer: true })!;

    if (queueUrl === sqsConfig.exportJobsUrl) {
      return 'export-jobs-producer';
    } else if (queueUrl === sqsConfig.downloadTasksUrl) {
      return 'download-tasks-producer';
    }

    throw new Error(`Unknown queue URL: ${queueUrl}`);
  }

  async sendMessage<T>(
    queueUrl: string,
    message: T,
    options?: SendMessageOptions,
  ): Promise<string> {
    this.logger.debug(`Sending message to queue: ${queueUrl}`);

    const producerName = this.getProducerName(queueUrl);

    const result = await this.sqsService.send(producerName, {
      id: options?.deduplicationId || `msg-${Date.now()}`,
      body: message,
      groupId: options?.messageGroupId,
      deduplicationId: options?.deduplicationId,
      delaySeconds: options?.delaySeconds,
    });

    return result[0]?.MessageId ?? '';
  }

  async sendMessageBatch<T>(
    queueUrl: string,
    messages: T[],
    options?: SendMessageOptions,
  ): Promise<string[]> {
    this.logger.debug(`Sending ${messages.length} messages to queue: ${queueUrl}`);

    const producerName = this.getProducerName(queueUrl);

    const entries = messages.map((message, index) => ({
      id: `msg-${Date.now()}-${index}`,
      body: message,
      groupId: options?.messageGroupId,
      deduplicationId: options?.deduplicationId,
      delaySeconds: options?.delaySeconds,
    }));

    const result = await this.sqsService.send(producerName, entries);

    return result.map((r) => r.MessageId ?? '');
  }

  async receiveMessages<T>(
    _queueUrl: string,
    _maxMessages: number = 1,
    _waitTimeSeconds: number = 20,
  ): Promise<QueueMessage<T>[]> {
    // Note: @ssut/nestjs-sqs handles message receiving automatically via @SqsMessageHandler
    // This method is kept for backward compatibility but shouldn't be used directly
    this.logger.warn(
      'receiveMessages should not be used with @ssut/nestjs-sqs - use @SqsMessageHandler decorator instead',
    );
    return [];
  }

  async deleteMessage(_queueUrl: string, _receiptHandle: string): Promise<void> {
    // Note: @ssut/nestjs-sqs handles message deletion automatically
    // Messages are deleted when handler completes successfully (no throw)
    this.logger.warn(
      'deleteMessage should not be used with @ssut/nestjs-sqs - automatic deletion on handler success',
    );
  }

  async deleteMessageBatch(_queueUrl: string, _receiptHandles: string[]): Promise<void> {
    // Note: @ssut/nestjs-sqs handles message deletion automatically
    this.logger.warn(
      'deleteMessageBatch should not be used with @ssut/nestjs-sqs - automatic deletion on handler success',
    );
  }

  async changeMessageVisibility(
    _queueUrl: string,
    _receiptHandle: string,
    _visibilityTimeout: number,
  ): Promise<void> {
    // Note: @ssut/nestjs-sqs handles visibility timeout via queue configuration
    this.logger.warn(
      'changeMessageVisibility should not be used with @ssut/nestjs-sqs - configure via queue settings',
    );
  }
}
