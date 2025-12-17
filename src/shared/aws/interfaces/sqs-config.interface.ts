export interface SqsConfig {
  queueUrl: string;
  maxMessages: number;
  waitTimeSeconds: number;
  visibilityTimeout: number;
}

export interface SqsConsumerOptions {
  batchSize?: number;
  pollingWaitTimeMs?: number;
  visibilityTimeout?: number;
}
