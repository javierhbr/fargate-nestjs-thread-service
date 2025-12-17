# Quick Start - Hexagonal Architecture

A **5-minute guide** to understanding and using the new hexagonal architecture.

## What Changed?

Your export service now follows **Hexagonal Architecture** - business logic is separated from infrastructure.

## 3 Main Layers

```
┌─────────────────────────┐
│   1. DOMAIN (Core)      │  ← Pure business logic (no dependencies)
│   ExportJobEntity       │
│   DownloadTaskEntity    │
│   JobStateVO            │
└─────────────────────────┘
           ↑
┌─────────────────────────┐
│   2. APPLICATION        │  ← Orchestration (use cases)
│   StartExportJobUseCase │
│   PollExportStatusUseC. │
│   ProcessFileUseCase    │
└─────────────────────────┘
           ↑
┌─────────────────────────┐
│   3. INFRASTRUCTURE     │  ← Adapters to external services
│   DynamoDbAdapter       │     (AWS, HTTP, etc.)
│   SqsAdapter            │
│   S3Adapter             │
└─────────────────────────┘
```

## File Locations

```
src/
├── domain/                   # Layer 1: Pure business logic
│   ├── entities/             # ExportJob, DownloadTask
│   ├── value-objects/        # JobState, JobStatus, FileMetadata
│   └── events/               # Domain events
│
├── application/              # Layer 2: Use cases
│   ├── ports/
│   │   ├── input/            # Use case interfaces
│   │   └── output/           # What we need from infrastructure
│   └── use-cases/            # Business orchestration
│
└── infrastructure/           # Layer 3: Adapters
    └── adapters/
        ├── persistence/      # DynamoDB adapter
        ├── messaging/        # SQS adapter
        ├── storage/          # S3 adapter
        └── events/           # Event publisher
```

## How to Use

### Example 1: Start an Export Job

**Old way** (tightly coupled):
```typescript
@Injectable()
class MyService {
  constructor(
    private dynamoDb: DynamoDbService,
    private sqs: SqsService,
    private s3: S3Service,
  ) {}

  async startJob() {
    // Business logic mixed with infrastructure
    await this.dynamoDb.createJobState({...});
    await this.sqs.sendMessage(...);
  }
}
```

**New way** (hexagonal):
```typescript
@Injectable()
class MyService {
  constructor(
    private startExportJobUseCase: StartExportJobUseCase,
  ) {}

  async startJob() {
    // Clean business operation
    const result = await this.startExportJobUseCase.execute({
      jobId: '123',
      exportId: 'exp-456',
      userId: 'user-789',
    });

    if (result.needsPolling) {
      // Handle polling
    }
  }
}
```

### Example 2: Process a File

```typescript
@Injectable()
class WorkerService {
  constructor(
    private processFileUseCase: ProcessFileUseCase,
  ) {}

  async handleDownloadTask(task: any) {
    const result = await this.processFileUseCase.execute({
      taskId: task.taskId,
      jobId: task.jobId,
      downloadUrl: task.downloadUrl,
      fileName: task.fileName,
      s3OutputKey: task.s3OutputKey,
      s3Bucket: 'my-bucket',
    });

    if (result.success) {
      console.log(`File uploaded to ${result.s3Key}`);
    } else {
      console.error(`Failed: ${result.errorMessage}`);
    }
  }
}
```

## Available Use Cases

### 1. `StartExportJobUseCase`
**What**: Creates a new export job and checks if export is ready
**Input**: `{ jobId, exportId, userId, metadata? }`
**Output**: `{ job, needsPolling, canStartDownloading }`

### 2. `PollExportStatusUseCase`
**What**: Checks external export API for status updates
**Input**: `{ jobId }`
**Output**: `{ job, isReady, isFailed, shouldContinuePolling, downloadUrls? }`

### 3. `DispatchDownloadTasksUseCase`
**What**: Creates download tasks and distributes to workers
**Input**: `{ jobId, downloadUrls[] }`
**Output**: `{ totalTasksDispatched, tasksToWorkerPool, tasksToOverflowQueue }`

### 4. `ProcessFileUseCase`
**What**: Downloads file, validates, uploads to S3
**Input**: `{ taskId, jobId, downloadUrl, fileName, s3OutputKey, s3Bucket }`
**Output**: `{ success, s3Key?, fileSize?, errorMessage? }`

### 5. `CompleteJobUseCase`
**What**: Updates job after task completion, checks if all done
**Input**: `{ jobId, taskId, success, errorMessage? }`
**Output**: `{ job, isJobComplete, allTasksSucceeded }`

## Testing

### Domain Layer (No mocks!)
```typescript
test('Job tracks completion correctly', () => {
  const job = ExportJobEntity.create({
    jobId: '123',
    exportId: 'exp-456',
    userId: 'user-789',
    jobState: JobStateVO.create({ totalTasks: 3 }),
  });

  const updated = job.incrementCompletedTasks();

  expect(updated.completedTasks).toBe(1);
  expect(updated.isComplete()).toBe(false);
});
```

### Use Cases (Mock ports)
```typescript
test('StartExportJob creates job', async () => {
  const mockRepo = { save: jest.fn() };
  const mockApi = { getExportStatus: jest.fn().mockResolvedValue({
    status: ExportStatusVO.ready(),
    downloadUrls: ['https://...'],
  }) };

  const useCase = new StartExportJobUseCase(mockRepo, mockApi, ...);

  const result = await useCase.execute({
    jobId: '123',
    exportId: 'exp-456',
    userId: 'user-789',
  });

  expect(mockRepo.save).toHaveBeenCalled();
  expect(result.canStartDownloading).toBe(true);
});
```

## Key Concepts

### Entities (Domain)
Mutable objects with identity and business logic.

```typescript
const job = ExportJobEntity.create({...});
const updated = job.incrementCompletedTasks();  // Returns new instance
```

### Value Objects (Domain)
Immutable objects without identity.

```typescript
const status = JobStatusVO.fromString('PENDING');
if (status.isTerminal()) {
  // Do something
}
```

### Ports (Application)
Interfaces that define contracts.

```typescript
export interface JobStateRepositoryPort {
  save(job: ExportJobEntity): Promise<void>;
  findById(jobId: string): Promise<ExportJobEntity | null>;
}
```

### Adapters (Infrastructure)
Implementations of ports.

```typescript
@Injectable()
class DynamoDbJobRepositoryAdapter implements JobStateRepositoryPort {
  async save(job: ExportJobEntity) {
    // Convert to DynamoDB format and save
  }
}
```

## Integration Steps

### Step 1: Import Modules

In `app.module.ts`:
```typescript
@Module({
  imports: [
    InfrastructureModule,  // Must come first!
    ApplicationModule,
    // ... other modules
  ],
})
export class AppModule {}
```

### Step 2: Inject Use Cases

In your services/consumers:
```typescript
@Injectable()
export class ExportJobConsumer {
  constructor(
    private readonly startExportJobUseCase: StartExportJobUseCase,
    private readonly dispatchTasksUseCase: DispatchDownloadTasksUseCase,
  ) {}

  async handleMessage(msg: any) {
    const result = await this.startExportJobUseCase.execute(msg);

    if (result.canStartDownloading) {
      await this.dispatchTasksUseCase.execute({
        jobId: result.job.jobId,
        downloadUrls: msg.downloadUrls,
      });
    }
  }
}
```

### Step 3: Done!

NestJS handles dependency injection automatically.

## Benefits

1. **Testable**: Domain and use cases don't need AWS services
2. **Flexible**: Swap DynamoDB for PostgreSQL without changing business logic
3. **Clear**: All business rules in one place (domain entities)
4. **Maintainable**: Clean separation of concerns

## Cheat Sheet

| Layer | Location | Dependencies | Purpose |
|-------|----------|--------------|---------|
| **Domain** | `src/domain/` | None | Business rules & entities |
| **Application** | `src/application/` | Domain only | Orchestration (use cases) |
| **Infrastructure** | `src/infrastructure/` | Everything | Connect to external services |

## Migration Path

Both old and new architectures can coexist:

```
src/
├── domain/            ← NEW
├── application/       ← NEW
├── infrastructure/    ← NEW
├── processing/        ← OLD (still works)
├── shared/            ← OLD (used by adapters)
└── worker-pool/       ← OLD (still works)
```

Gradually migrate consumers and services to use new use cases.

## Need Help?

1. **Architecture concepts**: See [HEXAGONAL_ARCHITECTURE.md](HEXAGONAL_ARCHITECTURE.md)
2. **Module setup**: See [MODULE_SETUP_GUIDE.md](MODULE_SETUP_GUIDE.md)
3. **Full implementation details**: See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)

## Quick Reference

### Inject a Use Case
```typescript
constructor(private readonly myUseCase: MyUseCase) {}
```

### Execute a Use Case
```typescript
const result = await this.myUseCase.execute(command);
```

### Create a Domain Entity
```typescript
const job = ExportJobEntity.create({...});
```

### Test Domain Logic
```typescript
const updated = entity.someBusinessOperation();
expect(updated.someProperty).toBe(expectedValue);
```

That's it! You're ready to use the hexagonal architecture.

---

**Pro Tip**: Start by reading `HEXAGONAL_ARCHITECTURE.md` for the full picture, then come back to this guide for quick reference.
