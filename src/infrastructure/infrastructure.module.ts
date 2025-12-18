import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Shared services (existing infrastructure)
import { SqsModule } from '../shared/aws/sqs/sqs.module';
import { S3Module } from '../shared/aws/s3/s3.module';
import { DynamoDbModule } from '../shared/aws/dynamodb/dynamodb.module';
import { StepFunctionsModule } from '../shared/aws/step-functions/step-functions.module';
import { LoggingModule } from '../shared/logging/logging.module';

// Injection tokens (string symbols for DI)
export const JOB_STATE_REPOSITORY_PORT = 'JobStateRepositoryPort';
export const MESSAGE_QUEUE_PORT = 'MessageQueuePort';
export const FILE_STORAGE_PORT = 'FileStoragePort';
export const EVENT_PUBLISHER_PORT = 'EventPublisherPort';
export const STEP_FUNCTIONS_PORT = 'StepFunctionsPort';

// Adapters (implementations)
import { DynamoDbJobRepositoryAdapter } from './adapters/persistence/dynamodb-job-repository.adapter';
import { SqsMessageQueueAdapter } from './adapters/messaging/sqs-message-queue.adapter';
import { S3FileStorageAdapter } from './adapters/storage/s3-file-storage.adapter';
import { ConsoleEventPublisherAdapter } from './adapters/events/console-event-publisher.adapter';
import { StepFunctionsAdapter } from './adapters/step-functions/step-functions.adapter';

/**
 * Infrastructure Module
 * Provides implementations (adapters) for all output ports
 *
 * This module:
 * 1. Imports shared infrastructure modules (AWS services, etc.)
 * 2. Creates adapters that implement ports
 * 3. Exports adapters so they can be injected into use cases
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    SqsModule,
    S3Module,
    DynamoDbModule,
    StepFunctionsModule,
  ],
  providers: [
    // Persistence adapters
    DynamoDbJobRepositoryAdapter,
    {
      provide: JOB_STATE_REPOSITORY_PORT,
      useClass: DynamoDbJobRepositoryAdapter,
    },

    // Messaging adapters
    SqsMessageQueueAdapter,
    {
      provide: MESSAGE_QUEUE_PORT,
      useClass: SqsMessageQueueAdapter,
    },

    // Storage adapters
    S3FileStorageAdapter,
    {
      provide: FILE_STORAGE_PORT,
      useClass: S3FileStorageAdapter,
    },

    // Event publisher adapter
    ConsoleEventPublisherAdapter,
    {
      provide: EVENT_PUBLISHER_PORT,
      useClass: ConsoleEventPublisherAdapter,
    },

    // Step Functions adapter
    StepFunctionsAdapter,
    {
      provide: STEP_FUNCTIONS_PORT,
      useClass: StepFunctionsAdapter,
    },

    // Add other adapters here:
    // - ExportApiPort → ExportApiHttpAdapter
    // - WorkerPoolPort → WorkerPoolAdapter
  ],
  exports: [
    // Export port tokens so they can be injected
    JOB_STATE_REPOSITORY_PORT,
    MESSAGE_QUEUE_PORT,
    FILE_STORAGE_PORT,
    EVENT_PUBLISHER_PORT,
    STEP_FUNCTIONS_PORT,
  ],
})
export class InfrastructureModule {}
