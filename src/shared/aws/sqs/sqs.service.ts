import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { AppConfig } from '../../../config/configuration';
import {
  SqsMessageEnvelope,
  SqsDeleteResult,
  SqsSendResult,
} from '../interfaces/sqs-message.interface';
import { PinoLoggerService } from '../../logging/pino-logger.service';

@Injectable()
export class SqsService implements OnModuleDestroy {
  private readonly client: SQSClient;
  private readonly maxMessages: number;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeout: number;

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const awsConfig = this.configService.get('aws', { infer: true })!;
    const sqsConfig = this.configService.get('sqs', { infer: true })!;

    this.client = new SQSClient({
      region: awsConfig.region,
      ...(awsConfig.endpoint && { endpoint: awsConfig.endpoint }),
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });

    this.maxMessages = sqsConfig.maxMessages;
    this.waitTimeSeconds = sqsConfig.waitTimeSeconds;
    this.visibilityTimeout = sqsConfig.visibilityTimeout;

    this.logger.setContext(SqsService.name);
  }

  async receiveMessages<T>(
    queueUrl: string,
    maxMessages?: number,
  ): Promise<SqsMessageEnvelope<T>[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxMessages ?? this.maxMessages,
      WaitTimeSeconds: this.waitTimeSeconds,
      VisibilityTimeout: this.visibilityTimeout,
      MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.client.send(command);

    if (!response.Messages || response.Messages.length === 0) {
      return [];
    }

    return response.Messages.map((message) => {
      let body: T;
      try {
        body = JSON.parse(message.Body || '{}') as T;
      } catch {
        this.logger.warn(
          { messageId: message.MessageId },
          'Failed to parse message body as JSON',
        );
        body = message.Body as unknown as T;
      }

      return {
        message,
        body,
        receiptHandle: message.ReceiptHandle!,
        messageId: message.MessageId!,
        approximateReceiveCount: parseInt(
          message.Attributes?.ApproximateReceiveCount || '1',
          10,
        ),
      };
    });
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<SqsDeleteResult> {
    try {
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
      return { messageId: receiptHandle, success: true };
    } catch (error) {
      this.logger.error({ error, receiptHandle }, 'Failed to delete message');
      return {
        messageId: receiptHandle,
        success: false,
        error: error as Error,
      };
    }
  }

  async sendMessage<T>(
    queueUrl: string,
    body: T,
    options?: {
      delaySeconds?: number;
      messageGroupId?: string;
      messageDeduplicationId?: string;
    },
  ): Promise<SqsSendResult> {
    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(body),
      DelaySeconds: options?.delaySeconds,
      MessageGroupId: options?.messageGroupId,
      MessageDeduplicationId: options?.messageDeduplicationId,
    });

    const response = await this.client.send(command);

    return {
      messageId: response.MessageId!,
      sequenceNumber: response.SequenceNumber,
    };
  }

  async sendMessageBatch<T>(
    queueUrl: string,
    messages: Array<{
      id: string;
      body: T;
      delaySeconds?: number;
    }>,
  ): Promise<{ successful: string[]; failed: string[] }> {
    const entries = messages.map((msg) => ({
      Id: msg.id,
      MessageBody: JSON.stringify(msg.body),
      DelaySeconds: msg.delaySeconds,
    }));

    const command = new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: entries,
    });

    const response = await this.client.send(command);

    return {
      successful: response.Successful?.map((s) => s.Id!) || [],
      failed: response.Failed?.map((f) => f.Id!) || [],
    };
  }

  async changeVisibility(
    queueUrl: string,
    receiptHandle: string,
    visibilityTimeout: number,
  ): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: visibilityTimeout,
      }),
    );
  }

  async getQueueAttributes(
    queueUrl: string,
  ): Promise<{ approximateMessages: number; approximateMessagesNotVisible: number }> {
    const response = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
        ],
      }),
    );

    return {
      approximateMessages: parseInt(
        response.Attributes?.ApproximateNumberOfMessages || '0',
        10,
      ),
      approximateMessagesNotVisible: parseInt(
        response.Attributes?.ApproximateNumberOfMessagesNotVisible || '0',
        10,
      ),
    };
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
