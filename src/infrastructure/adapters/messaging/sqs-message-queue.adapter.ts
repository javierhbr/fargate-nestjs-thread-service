import { Injectable, Logger } from '@nestjs/common';
import {
  MessageQueuePort,
  QueueMessage,
  SendMessageOptions,
} from '../../../application/ports/output/message-queue.port';
import { SqsService } from '../../../shared/aws/sqs/sqs.service';

/**
 * SQS Message Queue Adapter
 * Implements MessageQueuePort using AWS SQS
 */
@Injectable()
export class SqsMessageQueueAdapter implements MessageQueuePort {
  private readonly logger = new Logger(SqsMessageQueueAdapter.name);

  constructor(private readonly sqsService: SqsService) {}

  async sendMessage<T>(queueUrl: string, message: T, options?: SendMessageOptions): Promise<string> {
    this.logger.debug(`Sending message to queue: ${queueUrl}`);

    const result = await this.sqsService.sendMessage(queueUrl, {
      body: message,
      delaySeconds: options?.delaySeconds,
      messageGroupId: options?.messageGroupId,
      messageDeduplicationId: options?.deduplicationId,
    });

    return result.MessageId ?? '';
  }

  async sendMessageBatch<T>(queueUrl: string, messages: T[], options?: SendMessageOptions): Promise<string[]> {
    this.logger.debug(`Sending ${messages.length} messages to queue: ${queueUrl}`);

    const entries = messages.map((message, index) => ({
      id: `msg-${index}`,
      body: message,
      delaySeconds: options?.delaySeconds,
      messageGroupId: options?.messageGroupId,
    }));

    const result = await this.sqsService.sendMessageBatch(queueUrl, entries);

    return result.Successful?.map((s) => s.MessageId ?? '') ?? [];
  }

  async receiveMessages<T>(
    queueUrl: string,
    maxMessages: number = 1,
    waitTimeSeconds: number = 20,
  ): Promise<QueueMessage<T>[]> {
    const messages = await this.sqsService.receiveMessages(queueUrl, {
      maxMessages,
      waitTimeSeconds,
    });

    return messages.map((msg) => ({
      messageId: msg.MessageId ?? '',
      body: msg.Body ? JSON.parse(msg.Body) : undefined,
      receiptHandle: msg.ReceiptHandle,
      attributes: msg.Attributes,
    }));
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.sqsService.deleteMessage(queueUrl, receiptHandle);
    this.logger.debug(`Deleted message from queue: ${queueUrl}`);
  }

  async deleteMessageBatch(queueUrl: string, receiptHandles: string[]): Promise<void> {
    const entries = receiptHandles.map((handle, index) => ({
      id: `msg-${index}`,
      receiptHandle: handle,
    }));

    await this.sqsService.deleteMessageBatch(queueUrl, entries);
    this.logger.debug(`Deleted ${receiptHandles.length} messages from queue: ${queueUrl}`);
  }

  async changeMessageVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeout: number,
  ): Promise<void> {
    await this.sqsService.changeMessageVisibility(queueUrl, receiptHandle, visibilityTimeout);
    this.logger.debug(`Changed message visibility in queue: ${queueUrl}`);
  }
}
