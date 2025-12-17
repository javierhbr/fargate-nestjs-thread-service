import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Shared services (existing infrastructure)
import { SqsModule } from '../shared/aws/sqs/sqs.module';
import { S3Module } from '../shared/aws/s3/s3.module';
import { DynamoDbModule } from '../shared/aws/dynamodb/dynamodb.module';
import { StepFunctionsModule } from '../shared/aws/step-functions/step-functions.module';
import { HttpClientModule } from '../shared/http/http-client.module';
import { LoggingModule } from '../shared/logging/logging.module';

// Port tokens (for dependency injection)
import { JobStateRepositoryPort } from '../application/ports/output/job-state-repository.port';
import { MessageQueuePort } from '../application/ports/output/message-queue.port';
import { FileStoragePort } from '../application/ports/output/file-storage.port';
import { EventPublisherPort } from '../application/ports/output/event-publisher.port';
import { StepFunctionsPort } from '../application/ports/output/step-functions.port';

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
    HttpClientModule,
  ],
  providers: [
    // Persistence adapters
    DynamoDbJobRepositoryAdapter,
    {
      provide: JobStateRepositoryPort,
      useClass: DynamoDbJobRepositoryAdapter,
    },

    // Messaging adapters
    SqsMessageQueueAdapter,
    {
      provide: MessageQueuePort,
      useClass: SqsMessageQueueAdapter,
    },

    // Storage adapters
    S3FileStorageAdapter,
    {
      provide: FileStoragePort,
      useClass: S3FileStorageAdapter,
    },

    // Event publisher adapter
    ConsoleEventPublisherAdapter,
    {
      provide: EventPublisherPort,
      useClass: ConsoleEventPublisherAdapter,
    },

    // Step Functions adapter
    StepFunctionsAdapter,
    {
      provide: StepFunctionsPort,
      useClass: StepFunctionsAdapter,
    },

    // Add other adapters here:
    // - ExportApiPort → ExportApiHttpAdapter
    // - WorkerPoolPort → WorkerPoolAdapter
  ],
  exports: [
    // Export port tokens so they can be injected
    JobStateRepositoryPort,
    MessageQueuePort,
    FileStoragePort,
    EventPublisherPort,
    StepFunctionsPort,
  ],
})
export class InfrastructureModule {}
