/**
 * Message Queue Message
 */
export interface QueueMessage<T = unknown> {
  messageId: string;
  body: T;
  receiptHandle?: string;
  attributes?: Record<string, string>;
}

/**
 * Send Message Options
 */
export interface SendMessageOptions {
  delaySeconds?: number;
  messageGroupId?: string;
  deduplicationId?: string;
}

/**
 * Message Queue Port (Driven Port)
 * Interface for message queue operations (SQS)
 */
export interface MessageQueuePort {
  /**
   * Send a single message to a queue
   */
  sendMessage<T>(
    queueUrl: string,
    message: T,
    options?: SendMessageOptions,
  ): Promise<string>;

  /**
   * Send multiple messages in a batch
   */
  sendMessageBatch<T>(
    queueUrl: string,
    messages: T[],
    options?: SendMessageOptions,
  ): Promise<string[]>;

  /**
   * Receive messages from a queue
   */
  receiveMessages<T>(
    queueUrl: string,
    maxMessages?: number,
    waitTimeSeconds?: number,
  ): Promise<QueueMessage<T>[]>;

  /**
   * Delete a message from the queue after processing
   */
  deleteMessage(queueUrl: string, receiptHandle: string): Promise<void>;

  /**
   * Delete multiple messages in a batch
   */
  deleteMessageBatch(queueUrl: string, receiptHandles: string[]): Promise<void>;

  /**
   * Change the visibility timeout of a message
   */
  changeMessageVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeout: number,
  ): Promise<void>;
}
