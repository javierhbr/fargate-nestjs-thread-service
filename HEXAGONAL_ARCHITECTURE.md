# Hexagonal Architecture Implementation Guide

## Overview

This project now implements **Hexagonal Architecture** (also known as **Ports and Adapters Pattern**). This architectural pattern separates business logic from infrastructure concerns, making the codebase more maintainable, testable, and flexible.

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     DRIVING ADAPTERS (Input)                     │
│              (SQS Consumers, HTTP Controllers)                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │         Use Cases (Business Orchestration)              │    │
│  │  - StartExportJobUseCase                                │    │
│  │  - PollExportStatusUseCase                              │    │
│  │  - DispatchDownloadTasksUseCase                         │    │
│  │  - ProcessFileUseCase                                   │    │
│  │  - CompleteJobUseCase                                   │    │
│  └────────────────────────────────────────────────────────┘    │
│                          │                                       │
│  ┌───────────────────────┼────────────────────────────────┐    │
│  │  Input Ports          │        Output Ports            │    │
│  │  (Driving)            │        (Driven)                │    │
│  │  - Use Case           │        - JobStateRepository    │    │
│  │    Interfaces         │        - ExportApi             │    │
│  │                       │        - MessageQueue          │    │
│  │                       │        - FileStorage           │    │
│  │                       │        - WorkerPool            │    │
│  │                       │        - EventPublisher        │    │
│  └───────────────────────┴────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DOMAIN LAYER (Core)                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Domain Entities                            │    │
│  │  - ExportJobEntity (Aggregate Root)                     │    │
│  │  - DownloadTaskEntity                                   │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Value Objects                              │    │
│  │  - JobStateVO                                           │    │
│  │  - JobStatusVO                                          │    │
│  │  - ExportStatusVO                                       │    │
│  │  - FileMetadataVO                                       │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Domain Events                              │    │
│  │  - JobCreatedEvent                                      │    │
│  │  - TaskDispatchedEvent                                  │    │
│  │  - TaskCompletedEvent / TaskFailedEvent                 │    │
│  │  - JobCompletedEvent / JobFailedEvent                   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INFRASTRUCTURE LAYER                          │
│                                                                  │
│                    DRIVEN ADAPTERS (Output)                      │
│  - DynamoDbJobRepositoryAdapter → DynamoDB                      │
│  - ExportApiHttpAdapter → External HTTP API                     │
│  - SqsMessageQueueAdapter → AWS SQS                             │
│  - S3FileStorageAdapter → AWS S3                                │
│  - WorkerPoolAdapter → Worker Threads                           │
│  - EventPublisherAdapter → Event Bus                            │
└─────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── domain/                          # CORE - Pure business logic (no dependencies)
│   ├── entities/
│   │   ├── export-job.entity.ts     # Aggregate root
│   │   └── download-task.entity.ts  # Entity
│   ├── value-objects/
│   │   ├── job-state.vo.ts
│   │   ├── job-status.vo.ts
│   │   ├── export-status.vo.ts
│   │   └── file-metadata.vo.ts
│   └── events/
│       ├── base.event.ts
│       ├── job-created.event.ts
│       ├── task-dispatched.event.ts
│       ├── task-completed.event.ts
│       ├── task-failed.event.ts
│       ├── job-completed.event.ts
│       └── job-failed.event.ts
│
├── application/                     # USE CASES - Business orchestration
│   ├── ports/
│   │   ├── input/                   # Driving ports (use case interfaces)
│   │   │   ├── start-export-job.port.ts
│   │   │   ├── poll-export-status.port.ts
│   │   │   ├── dispatch-download-tasks.port.ts
│   │   │   ├── process-file.port.ts
│   │   │   └── complete-job.port.ts
│   │   └── output/                  # Driven ports (infrastructure interfaces)
│   │       ├── job-state-repository.port.ts
│   │       ├── export-api.port.ts
│   │       ├── message-queue.port.ts
│   │       ├── file-storage.port.ts
│   │       ├── worker-pool.port.ts
│   │       └── event-publisher.port.ts
│   └── use-cases/
│       ├── start-export-job.use-case.ts
│       ├── poll-export-status.use-case.ts
│       ├── dispatch-download-tasks.use-case.ts
│       ├── process-file.use-case.ts
│       └── complete-job.use-case.ts
│
└── infrastructure/                  # ADAPTERS - Framework & external services
    └── adapters/
        ├── persistence/
        │   └── dynamodb-job-repository.adapter.ts
        ├── external-api/
        │   └── export-api-http.adapter.ts
        ├── messaging/
        │   └── sqs-message-queue.adapter.ts
        ├── storage/
        │   └── s3-file-storage.adapter.ts
        ├── processing/
        │   └── worker-pool.adapter.ts
        └── events/
            └── event-publisher.adapter.ts
```

## Key Concepts

### 1. Domain Layer (Core)

**No external dependencies** - Pure TypeScript business logic.

#### Entities
- **ExportJobEntity**: Aggregate root representing an export job
  - Contains business rules for job lifecycle
  - Manages download tasks
  - Enforces invariants (e.g., task counts consistency)

- **DownloadTaskEntity**: Represents a file download task
  - Retry logic
  - Status transitions
  - Validation rules

#### Value Objects
- **Immutable** objects with no identity
- **Self-validating** - throw errors on invalid construction
- Examples: `JobStateVO`, `FileMetadataVO`

#### Domain Events
- Record things that happened in the domain
- Enable event-driven architecture
- Used for auditing, notifications, and cross-aggregate communication

### 2. Application Layer

Contains **use cases** - the application's business logic orchestration.

#### Ports (Interfaces)

**Input Ports (Driving)**: Define what the application can do
```typescript
export interface StartExportJobPort {
  execute(command: StartExportJobCommand): Promise<StartExportJobResult>;
}
```

**Output Ports (Driven)**: Define what the application needs from infrastructure
```typescript
export interface JobStateRepositoryPort {
  save(job: ExportJobEntity): Promise<void>;
  findById(jobId: string): Promise<ExportJobEntity | null>;
  // ...
}
```

#### Use Cases

Implement input ports, depend on output ports:

```typescript
@Injectable()
export class StartExportJobUseCase implements StartExportJobPort {
  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly exportApi: ExportApiPort,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: StartExportJobCommand): Promise<StartExportJobResult> {
    // Business logic orchestration
  }
}
```

### 3. Infrastructure Layer

**Adapters** that implement the output ports.

#### Example: DynamoDB Repository Adapter

```typescript
@Injectable()
export class DynamoDbJobRepositoryAdapter implements JobStateRepositoryPort {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async save(job: ExportJobEntity): Promise<void> {
    // Convert domain entity to database format
    // Call DynamoDB service
  }

  // ... other methods
}
```

## Benefits

### 1. Testability

**Domain Layer**: Test without any mocks
```typescript
test('ExportJobEntity tracks task completion', () => {
  const job = ExportJobEntity.create({...});
  const updatedJob = job.incrementCompletedTasks();
  expect(updatedJob.completedTasks).toBe(1);
});
```

**Use Cases**: Test with port mocks (no infrastructure)
```typescript
test('StartExportJobUseCase creates job', async () => {
  const mockRepository: JobStateRepositoryPort = {
    save: jest.fn(),
    // ...
  };

  const useCase = new StartExportJobUseCase(mockRepository, ...);
  await useCase.execute({...});

  expect(mockRepository.save).toHaveBeenCalled();
});
```

### 2. Flexibility

Easily swap implementations:
- DynamoDB → PostgreSQL (implement new adapter)
- SQS → RabbitMQ (implement new adapter)
- Add caching layer (decorator pattern on repository)

### 3. Business Logic Clarity

All business rules in one place:
```typescript
// In domain entity
canStartPolling(): boolean {
  return this.status.isPending() || this.status.equals(JobStatusVO.processing());
}
```

### 4. Framework Independence

Core business logic doesn't depend on:
- NestJS
- AWS SDK
- Any external library

Only use cases have `@Injectable()` decorator.

## How to Use

### Creating a New Use Case

1. **Define domain entities/value objects** (if needed)
   ```typescript
   // src/domain/entities/new-entity.ts
   export class NewEntity { ... }
   ```

2. **Define input port** (use case interface)
   ```typescript
   // src/application/ports/input/new-use-case.port.ts
   export interface NewUseCasePort {
     execute(command: NewCommand): Promise<NewResult>;
   }
   ```

3. **Define output ports** (if needed)
   ```typescript
   // src/application/ports/output/new-service.port.ts
   export interface NewServicePort {
     doSomething(): Promise<void>;
   }
   ```

4. **Implement use case**
   ```typescript
   // src/application/use-cases/new-use-case.ts
   @Injectable()
   export class NewUseCase implements NewUseCasePort {
     constructor(
       private readonly dependency: SomePort,
     ) {}

     async execute(command: NewCommand): Promise<NewResult> {
       // Orchestration logic
     }
   }
   ```

5. **Create adapter** (if new port)
   ```typescript
   // src/infrastructure/adapters/new-adapter.ts
   @Injectable()
   export class NewAdapter implements NewServicePort {
     async doSomething(): Promise<void> {
       // Infrastructure implementation
     }
   }
   ```

6. **Wire up in module**
   ```typescript
   // src/application/application.module.ts or app.module.ts
   providers: [
     NewUseCase,
     {
       provide: 'NewServicePort',
       useClass: NewAdapter,
     },
   ]
   ```

### Example Flow

**1. SQS Message arrives** (Driving Adapter)
```
SQS → ExportJobConsumer → StartExportJobUseCase
```

**2. Use Case executes** (Application Layer)
```typescript
const result = await startExportJobUseCase.execute({
  jobId: '123',
  exportId: 'exp-456',
  userId: 'user-789',
});
```

**3. Use Case uses ports** (Driven Adapters called)
```
StartExportJobUseCase →
  ├─ JobStateRepositoryPort → DynamoDbAdapter → DynamoDB
  ├─ ExportApiPort → HttpAdapter → External API
  └─ EventPublisherPort → EventBusAdapter → Event System
```

**4. Domain logic executed**
```typescript
const job = ExportJobEntity.create({...});
if (job.needsPolling(exportStatus)) {
  job = job.transitionToPolling();
}
```

## Migration Strategy

The current codebase still has the old architecture in:
- `/src/processing/` - Old consumers and services
- `/src/shared/aws/` - Direct AWS clients

**To migrate:**
1. Create new adapters for existing services
2. Update consumers to use new use cases
3. Gradually deprecate old services
4. Keep both architectures running during transition

## Testing Strategy

### Unit Tests
- **Domain**: No mocks, pure logic
  - `domain/entities/*.spec.ts`
  - `domain/value-objects/*.spec.ts`

- **Use Cases**: Mock ports only
  - `application/use-cases/*.spec.ts`

### Integration Tests
- **Adapters**: Test with real AWS services (LocalStack) or mocks
  - `infrastructure/adapters/*/*.spec.ts`

### E2E Tests
- Full workflow tests with real infrastructure

## References

- [Hexagonal Architecture (Alistair Cockburn)](https://alistair.cockburn.us/hexagonal-architecture/)
- [Ports and Adapters Pattern](https://herbertograca.com/2017/09/14/ports-adapters-architecture/)
- [Domain-Driven Design (DDD)](https://martinfowler.com/bliki/DomainDrivenDesign.html)

## Next Steps

1. ✅ Domain layer created
2. ✅ Ports defined
3. ✅ Use cases implemented
4. ✅ DynamoDB adapter created
5. 🔲 Create remaining adapters (Export API, SQS, S3, Worker Pool)
6. 🔲 Create application and infrastructure modules
7. 🔲 Wire up dependency injection
8. 🔲 Update consumers to use new use cases
9. 🔲 Write comprehensive tests
10. 🔲 Deprecate old services

---

**Questions or suggestions?** Please refer to the architecture diagram above and the code examples in this document.
