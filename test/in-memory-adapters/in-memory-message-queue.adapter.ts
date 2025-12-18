import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  MessageQueuePort,
  QueueMessage,
  SendMessageOptions,
} from '../../src/application/ports/output/message-queue.port';

interface InternalQueueMessage<T> {
  messageId: string;
  receiptHandle: string;
  body: T;
  attributes?: Record<string, string>;
  visibleAt: number;
  sentAt: number;
}

/**
 * In-Memory Message Queue Adapter
 * For ATDD testing - simulates SQS behavior in memory
 */
@Injectable()
export class InMemoryMessageQueueAdapter implements MessageQueuePort {
  private queues: Map<string, InternalQueueMessage<any>[]> = new Map();
  private defaultVisibilityTimeout = 30000; // 30 seconds in ms

  async sendMessage<T>(
    queueUrl: string,
    message: T,
    options?: SendMessageOptions,
  ): Promise<string> {
    const messageId = uuidv4();
    const receiptHandle = uuidv4();
    const now = Date.now();

    const queueMessage: InternalQueueMessage<T> = {
      messageId,
      receiptHandle,
      body: message,
      attributes: {},
      visibleAt: now + (options?.delaySeconds ? options.delaySeconds * 1000 : 0),
      sentAt: now,
    };

    if (!this.queues.has(queueUrl)) {
      this.queues.set(queueUrl, []);
    }

    this.queues.get(queueUrl)!.push(queueMessage);

    return messageId;
  }

  async sendMessageBatch<T>(
    queueUrl: string,
    messages: T[],
    options?: SendMessageOptions,
  ): Promise<string[]> {
    const messageIds: string[] = [];

    for (const message of messages) {
      const messageId = await this.sendMessage(queueUrl, message, options);
      messageIds.push(messageId);
    }

    return messageIds;
  }

  async receiveMessages<T>(
    queueUrl: string,
    maxMessages: number = 1,
    _waitTimeSeconds: number = 0,
  ): Promise<QueueMessage<T>[]> {
    const queue = this.queues.get(queueUrl);

    if (!queue || queue.length === 0) {
      return [];
    }

    const now = Date.now();
    const visibleMessages = queue.filter((msg) => msg.visibleAt <= now);

    const messagesToReturn = visibleMessages.slice(0, maxMessages);

    // Update visibility timeout for returned messages
    messagesToReturn.forEach((msg) => {
      msg.visibleAt = now + this.defaultVisibilityTimeout;
    });

    return messagesToReturn.map((msg) => ({
      messageId: msg.messageId,
      body: msg.body,
      receiptHandle: msg.receiptHandle,
      attributes: msg.attributes,
    }));
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    const queue = this.queues.get(queueUrl);

    if (!queue) {
      return;
    }

    const index = queue.findIndex((msg) => msg.receiptHandle === receiptHandle);
    if (index !== -1) {
      queue.splice(index, 1);
    }
  }

  async deleteMessageBatch(queueUrl: string, receiptHandles: string[]): Promise<void> {
    for (const receiptHandle of receiptHandles) {
      await this.deleteMessage(queueUrl, receiptHandle);
    }
  }

  async changeMessageVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeout: number,
  ): Promise<void> {
    const queue = this.queues.get(queueUrl);

    if (!queue) {
      return;
    }

    const message = queue.find((msg) => msg.receiptHandle === receiptHandle);
    if (message) {
      message.visibleAt = Date.now() + visibilityTimeout * 1000;
    }
  }

  // Test helper methods

  /**
   * Get all messages in a queue (including invisible ones)
   */
  getAllMessages<T>(queueUrl: string): T[] {
    const queue = this.queues.get(queueUrl);
    return queue ? queue.map((msg) => msg.body) : [];
  }

  /**
   * Get visible message count
   */
  getVisibleMessageCount(queueUrl: string): number {
    const queue = this.queues.get(queueUrl);
    if (!queue) {
      return 0;
    }

    const now = Date.now();
    return queue.filter((msg) => msg.visibleAt <= now).length;
  }

  /**
   * Get total message count (including invisible)
   */
  getMessageCount(queueUrl: string): number {
    const queue = this.queues.get(queueUrl);
    return queue ? queue.length : 0;
  }

  /**
   * Clear all messages from a queue
   */
  purgeQueue(queueUrl: string): void {
    this.queues.set(queueUrl, []);
  }

  /**
   * Clear all queues
   */
  clear(): void {
    this.queues.clear();
  }

  /**
   * Get all queue URLs
   */
  getQueueUrls(): string[] {
    return Array.from(this.queues.keys());
  }

  /**
   * Check if a queue exists
   */
  queueExists(queueUrl: string): boolean {
    return this.queues.has(queueUrl);
  }

  /**
   * Set default visibility timeout (for testing)
   */
  setDefaultVisibilityTimeout(timeoutMs: number): void {
    this.defaultVisibilityTimeout = timeoutMs;
  }
}
