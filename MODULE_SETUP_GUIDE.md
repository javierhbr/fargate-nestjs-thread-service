# Module Setup Guide - Hexagonal Architecture

This guide explains how to wire up the hexagonal architecture modules in your NestJS application.

## Module Structure

```
AppModule
├── ApplicationModule (Use Cases)
└── InfrastructureModule (Adapters)
    ├── SqsModule
    ├── S3Module
    ├── DynamoDbModule
    └── ... (other shared modules)
```

## Step 1: Application Module

The `ApplicationModule` contains all use cases. It **does not** import any infrastructure modules directly.

**File**: `src/application/application.module.ts`

```typescript
import { Module } from '@nestjs/common';
import {
  StartExportJobUseCase,
  PollExportStatusUseCase,
  DispatchDownloadTasksUseCase,
  ProcessFileUseCase,
  CompleteJobUseCase,
} from './use-cases';

@Module({
  providers: [
    StartExportJobUseCase,
    PollExportStatusUseCase,
    DispatchDownloadTasksUseCase,
    ProcessFileUseCase,
    CompleteJobUseCase,
  ],
  exports: [
    StartExportJobUseCase,
    PollExportStatusUseCase,
    DispatchDownloadTasksUseCase,
    ProcessFileUseCase,
    CompleteJobUseCase,
  ],
})
export class ApplicationModule {}
```

## Step 2: Infrastructure Module

The `InfrastructureModule` provides implementations (adapters) for all output ports.

**File**: `src/infrastructure/infrastructure.module.ts`

```typescript
import { Module } from '@nestjs/common';

// Import shared infrastructure modules
import { SqsModule } from '../shared/aws/sqs/sqs.module';
import { S3Module } from '../shared/aws/s3/s3.module';
import { DynamoDbModule } from '../shared/aws/dynamodb/dynamodb.module';

// Import port tokens
import { JobStateRepositoryPort } from '../application/ports/output/job-state-repository.port';
import { MessageQueuePort } from '../application/ports/output/message-queue.port';
import { FileStoragePort } from '../application/ports/output/file-storage.port';
import { EventPublisherPort } from '../application/ports/output/event-publisher.port';

// Import adapters
import { DynamoDbJobRepositoryAdapter } from './adapters/persistence/dynamodb-job-repository.adapter';
import { SqsMessageQueueAdapter } from './adapters/messaging/sqs-message-queue.adapter';
import { S3FileStorageAdapter } from './adapters/storage/s3-file-storage.adapter';
import { ConsoleEventPublisherAdapter } from './adapters/events/console-event-publisher.adapter';

@Module({
  imports: [
    SqsModule,
    S3Module,
    DynamoDbModule,
  ],
  providers: [
    // Bind adapters to ports
    DynamoDbJobRepositoryAdapter,
    {
      provide: JobStateRepositoryPort,
      useClass: DynamoDbJobRepositoryAdapter,
    },

    SqsMessageQueueAdapter,
    {
      provide: MessageQueuePort,
      useClass: SqsMessageQueueAdapter,
    },

    S3FileStorageAdapter,
    {
      provide: FileStoragePort,
      useClass: S3FileStorageAdapter,
    },

    ConsoleEventPublisherAdapter,
    {
      provide: EventPublisherPort,
      useClass: ConsoleEventPublisherAdapter,
    },
  ],
  exports: [
    // Export port tokens
    JobStateRepositoryPort,
    MessageQueuePort,
    FileStoragePort,
    EventPublisherPort,
  ],
})
export class InfrastructureModule {}
```

## Step 3: Update App Module

Import both modules in your root `AppModule`:

**File**: `src/app.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import validationSchema from './config/validation.schema';

// New architecture modules
import { ApplicationModule } from './application/application.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';

// Other modules (health, processing, etc.)
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),

    // Hexagonal architecture modules
    InfrastructureModule,  // Must come before ApplicationModule
    ApplicationModule,

    // Other existing modules
    HealthModule,
    // ... ProcessingModule, WorkerPoolModule, etc.
  ],
})
export class AppModule {}
```

**Important**: `InfrastructureModule` must be imported **before** `ApplicationModule` so that port implementations are available when use cases are instantiated.

## Step 4: Inject Use Cases into Consumers

Update your existing consumers to use the new use cases:

**Example**: Update `ExportJobConsumer`

```typescript
import { Injectable } from '@nestjs/common';
import { StartExportJobUseCase } from '../../application/use-cases/start-export-job.use-case';
import { DispatchDownloadTasksUseCase } from '../../application/use-cases/dispatch-download-tasks.use-case';

@Injectable()
export class ExportJobConsumer {
  constructor(
    private readonly startExportJobUseCase: StartExportJobUseCase,
    private readonly dispatchDownloadTasksUseCase: DispatchDownloadTasksUseCase,
  ) {}

  async handleMessage(message: any) {
    // Start the export job
    const result = await this.startExportJobUseCase.execute({
      jobId: message.jobId,
      exportId: message.exportId,
      userId: message.userId,
      metadata: message.metadata,
    });

    // If ready, dispatch download tasks
    if (result.canStartDownloading) {
      await this.dispatchDownloadTasksUseCase.execute({
        jobId: result.job.jobId,
        downloadUrls: message.downloadUrls,
      });
    }
  }
}
```

## Step 5: Inject Ports into Use Cases

Use cases receive port implementations via constructor injection:

```typescript
import { Injectable } from '@nestjs/common';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { ExportApiPort } from '../ports/output/export-api.port';
import { EventPublisherPort } from '../ports/output/event-publisher.port';

@Injectable()
export class StartExportJobUseCase {
  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly exportApi: ExportApiPort,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: StartExportJobCommand): Promise<StartExportJobResult> {
    // Use the ports (NestJS will inject the adapter implementations)
    await this.jobRepository.save(job);
    const exportStatus = await this.exportApi.getExportStatus(exportId);
    await this.eventPublisher.publish(event);
  }
}
```

NestJS will automatically inject the correct adapter implementations because we bound them in `InfrastructureModule`:

```typescript
{
  provide: JobStateRepositoryPort,
  useClass: DynamoDbJobRepositoryAdapter,  // This will be injected
}
```

## Dependency Injection Flow

```
1. AppModule imports InfrastructureModule
   └─> InfrastructureModule registers:
       JobStateRepositoryPort → DynamoDbJobRepositoryAdapter

2. AppModule imports ApplicationModule
   └─> ApplicationModule has StartExportJobUseCase

3. StartExportJobUseCase constructor requests JobStateRepositoryPort
   └─> NestJS injects DynamoDbJobRepositoryAdapter (from step 1)

4. Consumer injects StartExportJobUseCase
   └─> NestJS injects the fully-wired use case instance
```

## Testing Configuration

### Unit Tests (Use Cases)

Mock the ports directly:

```typescript
describe('StartExportJobUseCase', () => {
  let useCase: StartExportJobUseCase;
  let mockRepository: jest.Mocked<JobStateRepositoryPort>;
  let mockExportApi: jest.Mocked<ExportApiPort>;

  beforeEach(() => {
    mockRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      // ... other methods
    } as any;

    mockExportApi = {
      getExportStatus: jest.fn(),
      // ... other methods
    } as any;

    useCase = new StartExportJobUseCase(
      mockRepository,
      mockExportApi,
      mockEventPublisher,
    );
  });

  it('should create a new job', async () => {
    await useCase.execute({ ... });
    expect(mockRepository.save).toHaveBeenCalled();
  });
});
```

### Integration Tests (Adapters)

Use NestJS testing module with real adapters:

```typescript
describe('DynamoDbJobRepositoryAdapter', () => {
  let adapter: DynamoDbJobRepositoryAdapter;
  let dynamoDb: DynamoDbService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [DynamoDbModule],
      providers: [DynamoDbJobRepositoryAdapter],
    }).compile();

    adapter = module.get(DynamoDbJobRepositoryAdapter);
    dynamoDb = module.get(DynamoDbService);
  });

  it('should save a job', async () => {
    const job = ExportJobEntity.create({ ... });
    await adapter.save(job);
    // Verify in DynamoDB
  });
});
```

## Common Issues

### Issue 1: "Cannot resolve dependencies"

**Error**: `Nest can't resolve dependencies of the StartExportJobUseCase (?)`

**Solution**: Make sure `InfrastructureModule` exports the port tokens:

```typescript
@Module({
  exports: [
    JobStateRepositoryPort,  // Export the token, not the adapter class
    MessageQueuePort,
    FileStoragePort,
  ],
})
export class InfrastructureModule {}
```

### Issue 2: "Circular dependency"

**Solution**: Use `forwardRef()` or restructure modules to break the cycle.

### Issue 3: "Port is undefined at runtime"

**Solution**: Check that `InfrastructureModule` is imported **before** `ApplicationModule` in `AppModule`.

## Adding a New Adapter

1. Create the adapter class:
   ```typescript
   // src/infrastructure/adapters/new-adapter.ts
   @Injectable()
   export class NewAdapter implements NewPort {
     // Implementation
   }
   ```

2. Register in `InfrastructureModule`:
   ```typescript
   providers: [
     NewAdapter,
     {
       provide: NewPort,
       useClass: NewAdapter,
     },
   ],
   exports: [NewPort],
   ```

3. Inject into use case:
   ```typescript
   constructor(private readonly newService: NewPort) {}
   ```

That's it! NestJS handles the rest.

## Summary

- **ApplicationModule**: Contains use cases, exports them
- **InfrastructureModule**: Binds ports to adapters, exports ports
- **AppModule**: Imports Infrastructure → Application
- **Consumers/Controllers**: Inject use cases
- **Use Cases**: Inject ports (get adapters automatically)

This setup ensures clean separation of concerns while leveraging NestJS's powerful dependency injection system.
