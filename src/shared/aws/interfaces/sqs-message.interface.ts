import { Message } from '@aws-sdk/client-sqs';

export interface SqsMessageEnvelope<T = unknown> {
  message: Message;
  body: T;
  receiptHandle: string;
  messageId: string;
  approximateReceiveCount: number;
}

export interface SqsDeleteResult {
  messageId: string;
  success: boolean;
  error?: Error;
}

export interface SqsSendResult {
  messageId: string;
  sequenceNumber?: string;
}
