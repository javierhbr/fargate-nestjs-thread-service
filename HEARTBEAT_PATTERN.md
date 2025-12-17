# Heartbeat Pattern for Download Progress Tracking

## Table of Contents
- [Overview](#overview)
- [Thread Architecture](#thread-architecture)
- [Synchronization Model](#synchronization-model)
- [Heartbeat Flow](#heartbeat-flow)
- [Implementation Guide](#implementation-guide)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

### Concept

The **Heartbeat Pattern** enables long-running export jobs to prevent AWS Step Functions timeout by periodically sending heartbeat signals. This pattern follows a clear separation of responsibilities:

**Orchestrator Responsibility:**
- Keeps the Step Functions task token
- Sends periodic heartbeats to Step Functions
- Monitors overall job progress from DynamoDB

**Worker Responsibility:**
- Processes download tasks independently
- Reports completion to shared state (DynamoDB)
- No direct interaction with Step Functions

### Why Heartbeats?

AWS Step Functions tasks using `.waitForTaskToken` have configurable timeouts (default: 1 year max). For export jobs that may take hours to process hundreds or thousands of files, heartbeats:

1. **Prevent Timeout**: Reset the Step Functions timeout counter
2. **Provide Progress Updates**: Show job is still active
3. **Enable Long-Running Jobs**: Support jobs exceeding default timeout
4. **Decouple Concerns**: Workers focus on processing, orchestrator handles coordination

### Architecture Principles

```
┌─────────────────────────────────────────────────────────┐
│             Separation of Concerns                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Orchestrator (Main Thread)                            │
│  ┌─────────────────────────────────────┐              │
│  │ - Keeps task token                  │              │
│  │ - Sends heartbeats every 30s        │              │
│  │ - Monitors progress from DynamoDB   │              │
│  │ - Coordinates lifecycle              │              │
│  └─────────────────────────────────────┘              │
│                     ↕                                   │
│           DynamoDB (Single Source of Truth)            │
│  ┌─────────────────────────────────────┐              │
│  │ - Atomic progress counters          │              │
│  │ - Job status and metadata           │              │
│  │ - Task token storage                │              │
│  └─────────────────────────────────────┘              │
│                     ↕                                   │
│  Workers (4-8 Threads)                                 │
│  ┌─────────────────────────────────────┐              │
│  │ - Process download tasks            │              │
│  │ - Report completion to DynamoDB     │              │
│  │ - No knowledge of Step Functions    │              │
│  └─────────────────────────────────────┘              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Thread Architecture

### Process and Thread Model

Your export service runs with **multiple concurrent threads** coordinated through message passing and DynamoDB:

#### Main Process (Single Thread)

**Components:**
- **NestJS Application**: Event loop handling async I/O
- **PoolManagerService**: Orchestrates worker thread lifecycle
- **HeartbeatOrchestratorService**: Sends periodic heartbeats (NEW)
- **SQS Consumers**: Process incoming job messages
- **Use Cases**: Business logic execution (StartExportJob, CompleteJob, etc.)

**Thread Model:**
- Single JavaScript thread with event loop
- All async operations are non-blocking
- Event-driven coordination via callbacks and promises

#### Worker Threads (4-8 Isolated Threads)

**Location**: [src/worker-pool/threads/worker-thread.ts](src/worker-pool/threads/worker-thread.ts)

**Characteristics:**
- Each worker runs in **separate V8 isolate** (own heap, event loop)
- **No shared memory** with main process or other workers
- Communication via **message passing** only (serialized messages)
- **Independent execution**: Workers never communicate with each other

**Worker Count:**
- Configurable via `WORKER_POOL_SIZE` environment variable
- Default: 4 workers
- Recommendation: Number of CPU cores (typically 4-8 for Fargate)

### Thread Communication Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Main Process Thread                    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         Heartbeat Orchestrator                 │    │
│  │  setInterval(() => {                           │    │
│  │    sendHeartbeats();                           │    │
│  │  }, 30000);                                    │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │         Pool Manager Service                   │    │
│  │  - Assigns tasks to workers                    │    │
│  │  - Receives completion messages                │    │
│  │  - Updates DynamoDB counters                   │    │
│  └────────────────────────────────────────────────┘    │
│           ↕ postMessage (serialized objects)            │
└──────────────────────────────────────────────────────────┘
                          ↕
┌──────────────────────────────────────────────────────────┐
│              Worker Threads (Isolated)                   │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  ...        │
│  │          │  │          │  │          │             │
│  │ Download │  │ Download │  │ Download │             │
│  │ Validate │  │ Validate │  │ Validate │             │
│  │ Upload   │  │ Upload   │  │ Upload   │             │
│  │          │  │          │  │          │             │
│  │ Own Heap │  │ Own Heap │  │ Own Heap │             │
│  │ Own Loop │  │ Own Loop │  │ Own Loop │             │
│  └──────────┘  └──────────┘  └──────────┘             │
└──────────────────────────────────────────────────────────┘
```

**Message Protocol:**
```typescript
// Main → Worker
{
  type: 'PROCESS_TASK',
  payload: {
    taskId: 'task-123',
    url: 'https://api.example.com/file.pdf',
    jobId: 'abc-123',
    s3Bucket: 'exports',
    s3Key: 'exports/abc-123/file.pdf'
  }
}

// Worker → Main
{
  type: 'TASK_COMPLETED',
  payload: {
    taskId: 'task-123',
    jobId: 'abc-123',
    success: true,
    bytesProcessed: 1048576
  }
}
```

---

## Synchronization Model

### 1. DynamoDB as Single Source of Truth

**Why DynamoDB for Coordination?**
- **Atomic Operations**: `ADD` operation is thread-safe
- **Strongly Consistent Reads**: See latest state immediately
- **External to Process**: Survives process crashes/restarts
- **Scalable**: Handles high write throughput

**JobState Schema:**
```typescript
interface JobState {
  jobId: string;                    // Partition key
  exportId: string;
  userId: string;
  status: ExportJobStatus;          // PROCESSING, DOWNLOADING, COMPLETED, FAILED
  totalTasks: number;               // Set once when tasks are dispatched
  completedTasks: number;           // Incremented atomically by workers
  failedTasks: number;              // Incremented atomically by workers
  createdAt: string;
  updatedAt: string;                // Auto-updated on every change
  completedAt?: string;
  taskToken?: string;               // Step Functions task token
  error?: { code: string; message: string };
  metadata?: Record<string, unknown>;
  ttl?: number;
}
```

**Atomic Increment Example:**
```typescript
// Multiple workers can call this simultaneously - no race conditions
await dynamoDb.update({
  TableName: 'ExportJobs',
  Key: { jobId: 'abc-123' },
  UpdateExpression: 'ADD completedTasks :one SET updatedAt = :now',
  ExpressionAttributeValues: {
    ':one': 1,
    ':now': new Date().toISOString()
  }
});
```

**Concurrency Scenario:**
```
T=0:    Initial state: completedTasks = 0

T=1.0s: Worker 1 sends increment request → DynamoDB receives
T=1.1s: Worker 2 sends increment request → DynamoDB receives
T=1.2s: Worker 3 sends increment request → DynamoDB receives

T=1.3s: DynamoDB processes all three atomically
        Result: completedTasks = 3 ✅

T=1.4s: All workers receive success responses
```

### 2. Message Passing (No Shared Memory)

**Key Principle**: Workers and main process **never share memory**. All communication is via serialized messages.

**How It Works:**
1. Main process calls `worker.postMessage(message)`
2. Message is **serialized** (JSON-like)
3. Message is **copied** to worker's memory space
4. Worker receives message via `parentPort.on('message', handler)`
5. Worker processes in isolation
6. Worker sends response via `parentPort.postMessage(response)`
7. Response is serialized and copied back to main process

**Benefits:**
- ✅ No race conditions (no shared state)
- ✅ No need for locks, semaphores, or mutexes
- ✅ Worker crashes don't corrupt main process memory
- ✅ Clean separation of concerns

**Limitations:**
- ❌ Cannot pass functions or class instances (serialization)
- ❌ Cannot share large objects efficiently (copied, not shared)
- ✅ Solution: Pass references (S3 URLs, task IDs) instead of data

### 3. Event Loop Coordination (Main Thread)

The main thread uses Node.js event loop to coordinate all operations:

```
Event Loop Cycle (repeats continuously):
┌─────────────────────────────────────────────────────────┐
│ 1. Timers Phase                                         │
│    - Execute heartbeat interval callback (every 30s)    │
│    - Execute any other scheduled timers                 │
├─────────────────────────────────────────────────────────┤
│ 2. I/O Polling                                          │
│    - Check for worker messages (TASK_COMPLETED)         │
│    - Check for SQS messages (new jobs)                  │
│    - Check for DynamoDB responses                       │
│    - Check for Step Functions API responses             │
├─────────────────────────────────────────────────────────┤
│ 3. Check Phase                                          │
│    - Execute setImmediate callbacks                     │
├─────────────────────────────────────────────────────────┤
│ 4. Close Callbacks                                      │
│    - Handle worker termination events                   │
└─────────────────────────────────────────────────────────┘
```

**All operations are non-blocking:**
- AWS SDK calls return Promises (async I/O)
- Worker messages handled via EventEmitter
- No synchronous blocking in main thread

### 4. No Worker-to-Worker Synchronization

**Important**: Workers operate completely independently:
- ❌ Workers never communicate with each other
- ❌ Workers don't know how many other workers exist
- ❌ Workers don't coordinate task assignment
- ✅ All coordination happens through main process + DynamoDB

---

## Heartbeat Flow

### Complete Job Lifecycle with Heartbeats

#### Phase 1: Job Initialization (T=0s)

```
┌─────────────────────────────────────────────────────────┐
│ Step Functions State Machine                            │
│ Starts execution with .waitForTaskToken                 │
└────────────────┬────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────┐
│ SQS Message Sent                                        │
│ {                                                       │
│   jobId: "abc-123",                                     │
│   exportId: "export-456",                               │
│   userId: "user-789",                                   │
│   taskToken: "AAAAKgAAAAIAAAAA..."  ← Task token       │
│ }                                                       │
└────────────────┬────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────┐
│ ExportJobConsumer (Main Thread)                         │
│ 1. Receives SQS message                                 │
│ 2. Validates message with Zod schema                    │
│ 3. Extracts taskToken                                   │
│ 4. Stores in DynamoDB JobState table                    │
└────────────────┬────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────┐
│ DynamoDB JobState Table                                 │
│ {                                                       │
│   jobId: "abc-123",                                     │
│   status: "PROCESSING",                                 │
│   taskToken: "AAAAKgAAAAIAAAAA...",  ← Stored          │
│   totalTasks: 0,                                        │
│   completedTasks: 0,                                    │
│   createdAt: "2025-01-15T10:00:00Z"                     │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
```

#### Phase 2: Parallel Execution (T=0s → Job Complete)

**Three concurrent activities start:**

##### Activity A: Heartbeat Loop (Main Thread, Every 30s)

**File**: `src/application/services/heartbeat-orchestrator.service.ts` (NEW)

```typescript
@Injectable()
export class HeartbeatOrchestratorService implements OnModuleInit {
  private heartbeatInterval: NodeJS.Timeout;

  async onModuleInit() {
    const intervalMs = this.configService.get('stepFunctions.heartbeatIntervalMs', 30000);

    this.heartbeatInterval = setInterval(async () => {
      await this.sendHeartbeatsForActiveJobs();
    }, intervalMs);

    this.logger.log(`Heartbeat orchestrator started (interval: ${intervalMs}ms)`);
  }

  private async sendHeartbeatsForActiveJobs(): Promise<void> {
    // Query DynamoDB for jobs in DOWNLOADING status with taskToken
    const activeJobs = await this.jobRepository.findByStatus('DOWNLOADING');

    this.logger.debug(`Found ${activeJobs.length} active jobs requiring heartbeats`);

    for (const job of activeJobs) {
      if (job.hasTaskToken()) {
        try {
          await this.stepFunctions.sendTaskHeartbeat(job.taskToken);

          this.logger.debug({
            jobId: job.jobId,
            progress: `${job.completedTasks}/${job.totalTasks}`,
          }, 'Heartbeat sent successfully');

        } catch (error) {
          this.logger.error({
            jobId: job.jobId,
            error: error instanceof Error ? error.message : 'Unknown error',
          }, 'Heartbeat failed');

          // Don't throw - heartbeat failures shouldn't stop the loop
        }
      }
    }
  }
}
```

**Timeline:**
```
T=0s:   Heartbeat sent for job abc-123 (0/100 tasks complete)
T=30s:  Heartbeat sent for job abc-123 (12/100 tasks complete)
T=60s:  Heartbeat sent for job abc-123 (25/100 tasks complete)
T=90s:  Heartbeat sent for job abc-123 (39/100 tasks complete)
T=120s: Heartbeat sent for job abc-123 (54/100 tasks complete)
...continues until job completes
```

##### Activity B: Worker Pool Processing (Worker Threads)

**File**: [src/worker-pool/pool-manager.service.ts](src/worker-pool/pool-manager.service.ts)

**Single Worker Lifecycle:**
```
┌─────────────────────────────────────────────────────────┐
│ Main Thread                        Worker Thread 1      │
├─────────────────────────────────────────────────────────┤
│ postMessage({                                           │
│   type: 'PROCESS_TASK',                                 │
│   payload: {                                            │
│     taskId: 'task-1',                                   │
│     url: 'https://api.../file.pdf',                     │
│     jobId: 'abc-123'                                    │
│   }                                                     │
│ }) ──────────────────────────────────────────>          │
│                                                         │
│                                     Start download      │
│                                     (30-60 seconds)     │
│                                     ⏳                   │
│                                                         │
│                                     Validate checksum   │
│                                     (1-2 seconds)       │
│                                     ✓                   │
│                                                         │
│                                     Upload to S3        │
│                                     (10-20 seconds)     │
│                                     ⏳                   │
│                                                         │
│ <────────────────────────────────────────────           │
│ Message received:                                       │
│ {                                                       │
│   type: 'TASK_COMPLETED',                               │
│   payload: {                                            │
│     taskId: 'task-1',                                   │
│     jobId: 'abc-123',                                   │
│     success: true                                       │
│   }                                                     │
│ }                                                       │
│                                                         │
│ Update DynamoDB:                                        │
│ ADD completedTasks :1                                   │
│                                                         │
│ Assign next task:                                       │
│ postMessage({                                           │
│   type: 'PROCESS_TASK',                                 │
│   payload: { taskId: 'task-2', ... }                    │
│ }) ──────────────────────────────────────────>          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**4 Workers Running Concurrently:**
```
Time →  0s         30s        60s        90s        120s

Worker 1: [task-1........] [task-5......] [task-9......]
             ↓ +1            ↓ +1           ↓ +1
Worker 2:     [task-2..........] [task-6...........]
                 ↓ +1               ↓ +1
Worker 3:         [task-3.......] [task-7........]
                     ↓ +1            ↓ +1
Worker 4:             [task-4.....] [task-8......]
                         ↓ +1          ↓ +1

DynamoDB:  0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

Heartbeat:  ♥     ♥      ♥      ♥       ♥
           0s    30s    60s    90s    120s
           (0)   (4)    (7)    (9)    (9)
         tasks  tasks  tasks  tasks  tasks
```

##### Activity C: Progress Tracking (Main Thread, Event-Driven)

**File**: [src/processing/services/task-dispatcher.service.ts](src/processing/services/task-dispatcher.service.ts)

```typescript
private async handleTaskResult(result: ProcessingResult): Promise<void> {
  const jobLogger = this.logger.child({ jobId: result.jobId });

  // Update DynamoDB atomically
  if (result.success) {
    await this.dynamoDb.incrementTaskCount(result.jobId, 'completedTasks');
    jobLogger.info({ taskId: result.taskId }, 'Task completed successfully');
  } else {
    await this.dynamoDb.incrementTaskCount(result.jobId, 'failedTasks');
    jobLogger.warn({ taskId: result.taskId, error: result.error }, 'Task failed');
  }

  // Check if job is complete
  await this.checkJobCompletion(result.jobId);
}

private async checkJobCompletion(jobId: string): Promise<void> {
  const jobState = await this.dynamoDb.getJobState(jobId);

  const totalProcessed = jobState.completedTasks + jobState.failedTasks;

  if (totalProcessed === jobState.totalTasks) {
    this.logger.info({ jobId }, 'All tasks completed, finalizing job');

    // Send final callback to Step Functions
    const allSucceeded = jobState.failedTasks === 0;

    if (jobState.taskToken) {
      if (allSucceeded) {
        await this.stepFunctions.sendTaskSuccess(jobState.taskToken, {
          jobId: jobState.jobId,
          status: 'COMPLETED',
          totalTasks: jobState.totalTasks,
          completedTasks: jobState.completedTasks,
        });
      } else {
        await this.stepFunctions.sendTaskFailure(jobState.taskToken, {
          error: 'JobCompletedWithFailures',
          cause: `${jobState.failedTasks} tasks failed`,
        });
      }
    }

    // Update job status to COMPLETED
    await this.dynamoDb.updateJobStatus(jobId, 'COMPLETED');
  }
}
```

#### Phase 3: Job Completion (Final)

```
┌─────────────────────────────────────────────────────────┐
│ CompleteJobUseCase                                      │
│ Triggered when: completedTasks + failedTasks = total   │
│                                                         │
│ if (job.hasTaskToken()) {                               │
│   await stepFunctions.sendTaskSuccess(token, output);   │
│ }                                                       │
└────────────────┬────────────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────────────┐
│ Step Functions Receives Final Callback                  │
│ - Task resumes execution                                │
│ - Token becomes invalid (can't send more heartbeats)    │
│ - Moves to next state in state machine                  │
└─────────────────────────────────────────────────────────┘
```

**After completion:**
- Heartbeat orchestrator queries DynamoDB → job status = COMPLETED
- Job no longer in DOWNLOADING status → no heartbeats sent
- Resources cleaned up

---

## Implementation Guide

### Files to Create

#### 1. Heartbeat Orchestrator Service

**Path**: `src/application/services/heartbeat-orchestrator.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { StepFunctionsPort } from '../ports/output/step-functions.port';
import { AppConfig } from '../../config/configuration';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';

/**
 * Heartbeat Orchestrator Service
 *
 * Sends periodic heartbeats to Step Functions for active jobs to prevent timeout.
 * Follows the Heartbeat Pattern where the orchestrator monitors progress and
 * sends heartbeats, while workers independently process tasks and report to DynamoDB.
 */
@Injectable()
export class HeartbeatOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatOrchestratorService.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly stepFunctions: StepFunctionsPort,
    private readonly configService: ConfigService<AppConfig>,
    private readonly pinoLogger: PinoLoggerService,
  ) {
    this.pinoLogger.setContext(HeartbeatOrchestratorService.name);
  }

  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get('stepFunctions.heartbeatEnabled', true);

    if (!enabled) {
      this.logger.log('Heartbeat orchestrator disabled via configuration');
      return;
    }

    const intervalMs = this.configService.get(
      'stepFunctions.heartbeatIntervalMs',
      30000, // Default: 30 seconds
    );

    this.startHeartbeatLoop(intervalMs);
    this.logger.log(`Heartbeat orchestrator started (interval: ${intervalMs}ms)`);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHeartbeatLoop();
    this.logger.log('Heartbeat orchestrator stopped');
  }

  private startHeartbeatLoop(intervalMs: number): void {
    this.isRunning = true;

    this.heartbeatInterval = setInterval(async () => {
      if (this.isRunning) {
        await this.sendHeartbeatsForActiveJobs();
      }
    }, intervalMs);
  }

  private stopHeartbeatLoop(): void {
    this.isRunning = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Query DynamoDB for jobs in DOWNLOADING status and send heartbeats
   */
  private async sendHeartbeatsForActiveJobs(): Promise<void> {
    try {
      // Query jobs that need heartbeats
      const activeJobs = await this.jobRepository.findByStatus('DOWNLOADING');

      const jobsWithTokens = activeJobs.filter(job => job.hasTaskToken());

      if (jobsWithTokens.length === 0) {
        this.pinoLogger.debug('No active jobs requiring heartbeats');
        return;
      }

      this.pinoLogger.info(
        { activeJobCount: jobsWithTokens.length },
        'Sending heartbeats for active jobs',
      );

      // Send heartbeats for all active jobs
      await Promise.allSettled(
        jobsWithTokens.map(job => this.sendHeartbeatForJob(job)),
      );

    } catch (error) {
      this.logger.error(
        `Failed to query active jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Don't throw - continue heartbeat loop even if query fails
    }
  }

  /**
   * Send heartbeat for a single job
   */
  private async sendHeartbeatForJob(job: any): Promise<void> {
    const taskToken = job.taskToken!;
    const progress = job.totalTasks > 0
      ? Math.round((job.completedTasks / job.totalTasks) * 100)
      : 0;

    try {
      await this.stepFunctions.sendTaskHeartbeat(taskToken);

      this.pinoLogger.debug({
        jobId: job.jobId,
        progress: `${job.completedTasks}/${job.totalTasks} (${progress}%)`,
      }, 'Heartbeat sent successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Handle specific error cases
      if (errorMessage.includes('TaskDoesNotExist')) {
        this.logger.warn(
          `Task token no longer valid for job ${job.jobId} - execution may have completed`,
        );
      } else if (errorMessage.includes('TaskTimedOut')) {
        this.logger.error(
          `Task timed out for job ${job.jobId} - heartbeat interval may be too long`,
        );
      } else {
        this.logger.error(
          `Failed to send heartbeat for job ${job.jobId}: ${errorMessage}`,
        );
      }

      // Don't throw - heartbeat failures shouldn't crash the orchestrator
      // The job processing will continue regardless
    }
  }

  /**
   * Manually trigger heartbeat cycle (useful for testing)
   */
  async triggerHeartbeat(): Promise<void> {
    await this.sendHeartbeatsForActiveJobs();
  }
}
```

#### 2. Unit Tests for Heartbeat Orchestrator

**Path**: `src/application/services/__tests__/heartbeat-orchestrator.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HeartbeatOrchestratorService } from '../heartbeat-orchestrator.service';
import { JobStateRepositoryPort } from '../../ports/output/job-state-repository.port';
import { StepFunctionsPort } from '../../ports/output/step-functions.port';
import { PinoLoggerService } from '../../../shared/logging/pino-logger.service';
import { ExportJobEntity } from '../../../domain/entities/export-job.entity';
import { JobStateVO } from '../../../domain/value-objects/job-state.vo';

describe('HeartbeatOrchestratorService', () => {
  let service: HeartbeatOrchestratorService;
  let mockJobRepository: jest.Mocked<JobStateRepositoryPort>;
  let mockStepFunctions: jest.Mocked<StepFunctionsPort>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockJobRepository = {
      findByStatus: jest.fn(),
    } as any;

    mockStepFunctions = {
      sendTaskHeartbeat: jest.fn(),
      sendTaskSuccess: jest.fn(),
      sendTaskFailure: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'stepFunctions.heartbeatEnabled') return true;
        if (key === 'stepFunctions.heartbeatIntervalMs') return 30000;
        return defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HeartbeatOrchestratorService,
        {
          provide: JobStateRepositoryPort,
          useValue: mockJobRepository,
        },
        {
          provide: StepFunctionsPort,
          useValue: mockStepFunctions,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PinoLoggerService,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<HeartbeatOrchestratorService>(HeartbeatOrchestratorService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should send heartbeats for jobs with task tokens', async () => {
    const jobState = JobStateVO.create({
      status: 'DOWNLOADING',
      totalTasks: 100,
      completedTasks: 50,
      failedTasks: 0,
    });

    const job = ExportJobEntity.create({
      jobId: 'job-123',
      exportId: 'export-456',
      userId: 'user-789',
      jobState,
      taskToken: 'mock-token-123',
    });

    mockJobRepository.findByStatus.mockResolvedValue([job]);

    await service.triggerHeartbeat();

    expect(mockJobRepository.findByStatus).toHaveBeenCalledWith('DOWNLOADING');
    expect(mockStepFunctions.sendTaskHeartbeat).toHaveBeenCalledWith('mock-token-123');
  });

  it('should not send heartbeats for jobs without task tokens', async () => {
    const jobState = JobStateVO.create({
      status: 'DOWNLOADING',
      totalTasks: 100,
      completedTasks: 50,
      failedTasks: 0,
    });

    const job = ExportJobEntity.create({
      jobId: 'job-123',
      exportId: 'export-456',
      userId: 'user-789',
      jobState,
      // No taskToken
    });

    mockJobRepository.findByStatus.mockResolvedValue([job]);

    await service.triggerHeartbeat();

    expect(mockStepFunctions.sendTaskHeartbeat).not.toHaveBeenCalled();
  });

  it('should handle heartbeat failures gracefully', async () => {
    const jobState = JobStateVO.create({
      status: 'DOWNLOADING',
      totalTasks: 100,
      completedTasks: 50,
      failedTasks: 0,
    });

    const job = ExportJobEntity.create({
      jobId: 'job-123',
      exportId: 'export-456',
      userId: 'user-789',
      jobState,
      taskToken: 'invalid-token',
    });

    mockJobRepository.findByStatus.mockResolvedValue([job]);
    mockStepFunctions.sendTaskHeartbeat.mockRejectedValue(
      new Error('TaskDoesNotExist'),
    );

    // Should not throw
    await expect(service.triggerHeartbeat()).resolves.not.toThrow();
  });
});
```

### Files to Modify

#### 1. Step Functions Service - Add Heartbeat Method

**Path**: [src/shared/aws/step-functions/step-functions.service.ts](src/shared/aws/step-functions/step-functions.service.ts)

```typescript
import {
  SFNClient,
  SendTaskSuccessCommand,
  SendTaskFailureCommand,
  SendTaskHeartbeatCommand, // ADD THIS
} from '@aws-sdk/client-sfn';

// ... existing code ...

/**
 * Send heartbeat to Step Functions to prevent task timeout
 * @param taskToken - The task token received from Step Functions
 */
async sendTaskHeartbeat(taskToken: string): Promise<void> {
  try {
    const command = new SendTaskHeartbeatCommand({
      taskToken,
    });

    await this.client.send(command);

    this.logger.debug(
      { taskToken: this.maskTaskToken(taskToken) },
      'Step Functions heartbeat sent',
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    this.logger.error(
      {
        taskToken: this.maskTaskToken(taskToken),
        error: errorMessage,
      },
      'Failed to send Step Functions heartbeat',
    );

    throw error;
  }
}
```

#### 2. Step Functions Port - Add Heartbeat Method

**Path**: [src/application/ports/output/step-functions.port.ts](src/application/ports/output/step-functions.port.ts)

```typescript
/**
 * Interface for sending task token callbacks to AWS Step Functions
 */
export interface StepFunctionsPort {
  /**
   * Send task success callback to Step Functions
   */
  sendTaskSuccess(
    taskToken: string,
    output: StepFunctionsTaskSuccessOutput,
  ): Promise<void>;

  /**
   * Send task failure callback to Step Functions
   */
  sendTaskFailure(taskToken: string, failure: StepFunctionsTaskFailure): Promise<void>;

  /**
   * Send heartbeat to Step Functions to prevent task timeout
   * @param taskToken - The task token received from Step Functions
   */
  sendTaskHeartbeat(taskToken: string): Promise<void>; // ADD THIS
}
```

#### 3. Step Functions Adapter - Implement Heartbeat

**Path**: [src/infrastructure/adapters/step-functions/step-functions.adapter.ts](src/infrastructure/adapters/step-functions/step-functions.adapter.ts)

```typescript
// ... existing imports and code ...

async sendTaskHeartbeat(taskToken: string): Promise<void> {
  this.logger.debug('Sending heartbeat to Step Functions');

  try {
    await this.stepFunctionsService.sendTaskHeartbeat(taskToken);
    this.logger.debug('Successfully sent heartbeat');
  } catch (error) {
    this.logger.error(
      `Failed to send heartbeat: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    // Re-throw to allow caller to handle
    throw error;
  }
}
```

#### 4. Configuration - Add Heartbeat Settings

**Path**: [src/config/configuration.ts](src/config/configuration.ts)

```typescript
export interface AppConfig {
  // ... existing config ...

  stepFunctions: {
    heartbeatIntervalMs: number;  // How often to send heartbeats (milliseconds)
    heartbeatEnabled: boolean;    // Feature flag to enable/disable heartbeats
  };
}

export default (): AppConfig => ({
  // ... existing config ...

  stepFunctions: {
    heartbeatIntervalMs: parseInt(
      process.env.STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS || '30000',
      10,
    ),
    heartbeatEnabled: process.env.STEP_FUNCTIONS_HEARTBEAT_ENABLED !== 'false',
  },
});
```

#### 5. Configuration Validation Schema

**Path**: [src/config/validation.schema.ts](src/config/validation.schema.ts)

```typescript
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // ... existing validation ...

  STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS: Joi.number().integer().min(1000).default(30000),
  STEP_FUNCTIONS_HEARTBEAT_ENABLED: Joi.boolean().default(true),
});
```

#### 6. Job Repository Port - Add findByStatus Method

**Path**: [src/application/ports/output/job-state-repository.port.ts](src/application/ports/output/job-state-repository.port.ts)

```typescript
export abstract class JobStateRepositoryPort {
  abstract save(job: ExportJobEntity): Promise<void>;
  abstract findById(jobId: string): Promise<ExportJobEntity | null>;
  abstract updateJobState(jobId: string, state: JobStateVO): Promise<void>;
  abstract incrementCompletedTasks(jobId: string): Promise<void>;
  abstract incrementFailedTasks(jobId: string): Promise<void>;
  abstract setTotalTasks(jobId: string, totalTasks: number): Promise<void>;

  // ADD THIS:
  abstract findByStatus(status: string): Promise<ExportJobEntity[]>;
}
```

#### 7. DynamoDB Repository Adapter - Implement findByStatus

**Path**: [src/infrastructure/adapters/persistence/dynamodb-job-repository.adapter.ts](src/infrastructure/adapters/persistence/dynamodb-job-repository.adapter.ts)

```typescript
// ... existing code ...

async findByStatus(status: string): Promise<ExportJobEntity[]> {
  try {
    // Note: This requires a GSI on 'status' field
    const result = await this.dynamoDb.scan({
      FilterExpression: '#status = :status AND attribute_exists(taskToken)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
    });

    if (!result.Items || result.Items.length === 0) {
      return [];
    }

    return result.Items.map(item => this.toEntity(item as JobState));
  } catch (error) {
    this.logger.error(
      `Failed to query jobs by status ${status}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    throw error;
  }
}
```

**Note**: For production, consider creating a DynamoDB Global Secondary Index (GSI) on the `status` field for better performance:

```typescript
// DynamoDB GSI definition (infrastructure as code)
{
  IndexName: 'status-index',
  KeySchema: [
    { AttributeName: 'status', KeyType: 'HASH' }
  ],
  Projection: {
    ProjectionType: 'ALL'
  }
}
```

#### 8. Application Module - Register Heartbeat Orchestrator

**Path**: [src/application/application.module.ts](src/application/application.module.ts)

```typescript
import { Module } from '@nestjs/common';
import { HeartbeatOrchestratorService } from './services/heartbeat-orchestrator.service'; // ADD THIS

@Module({
  imports: [
    InfrastructureModule,
    // ... other imports
  ],
  providers: [
    // ... existing providers ...
    HeartbeatOrchestratorService, // ADD THIS
  ],
  exports: [
    // ... existing exports ...
  ],
})
export class ApplicationModule {}
```

#### 9. Update Documentation

**Path**: [STEP_FUNCTIONS_INTEGRATION.md](STEP_FUNCTIONS_INTEGRATION.md)

Add new section after "Best Practices":

```markdown
## Heartbeat Pattern

For detailed information about the heartbeat pattern implementation, including thread architecture, synchronization, and complete execution flow, see [HEARTBEAT_PATTERN.md](HEARTBEAT_PATTERN.md).

### Quick Overview

The heartbeat pattern prevents Step Functions timeout for long-running jobs:

- **Orchestrator**: Sends heartbeats every 30 seconds (configurable)
- **Workers**: Report progress to DynamoDB independently
- **DynamoDB**: Single source of truth for job progress
- **Step Functions**: Receives heartbeats and resets timeout counter

### Configuration

```bash
STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS=30000  # 30 seconds
STEP_FUNCTIONS_HEARTBEAT_ENABLED=true
```

### State Machine Configuration

```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "TimeoutSeconds": 3600,
  "HeartbeatSeconds": 60
}
```

**Important**: Set `HeartbeatSeconds` to 2x the heartbeat interval (e.g., if sending every 30s, set to 60s).
```

---

## Data Flow Diagrams

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Step Functions                           │
│                     (Workflow Orchestration)                        │
│                                                                     │
│  State Machine                                                      │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │ StartExportJob (.waitForTaskToken)                      │      │
│  │ - Timeout: 3600s                                        │      │
│  │ - Heartbeat: 60s                                        │      │
│  │ - Token: AAAAKgAAAAIAAAAA...                            │      │
│  └─────────────────────────────────────────────────────────┘      │
│         ↓ sends SQS message                    ↑ receives          │
│         ↓ with taskToken                       ↑ heartbeats        │
└─────────┼────────────────────────────────────────┼─────────────────┘
          ↓                                        ↑
┌─────────┼────────────────────────────────────────┼─────────────────┐
│         ↓          AWS SQS Queue                 ↑                 │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │ Message: {                                               │     │
│  │   jobId, exportId, userId,                               │     │
│  │   taskToken: "AAAAKgAAAAIAAAAA..."                       │     │
│  │ }                                                         │     │
│  └──────────────────────────────────────────────────────────┘     │
│         ↓ consumed by                                              │
└─────────┼──────────────────────────────────────────────────────────┘
          ↓
┌─────────┼──────────────────────────────────────────────────────────┐
│         ↓        Export Service (Fargate Container)                │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐      │
│  │              Main Process Thread                        │      │
│  │                                                         │      │
│  │  ┌────────────────────────────────────────────┐        │      │
│  │  │  Heartbeat Orchestrator                    │        │      │
│  │  │  (Every 30s)                                │        │      │
│  │  │                                             │        │      │
│  │  │  while (true) {                             │────────┼──────┼─→ Heartbeat
│  │  │    jobs = queryDynamoDB("DOWNLOADING")      │        │      │
│  │  │    for (job of jobs) {                      │        │      │
│  │  │      sendHeartbeat(job.taskToken)           │        │      │
│  │  │    }                                        │        │      │
│  │  │    sleep(30s)                               │        │      │
│  │  │  }                                          │        │      │
│  │  └────────────────────────────────────────────┘        │      │
│  │                ↕                                        │      │
│  │  ┌────────────────────────────────────────────┐        │      │
│  │  │     Pool Manager Service                    │        │      │
│  │  │  - Receives worker completion messages      │        │      │
│  │  │  - Updates DynamoDB counters                │        │      │
│  │  │  - Assigns tasks to idle workers            │        │      │
│  │  └────────────────────────────────────────────┘        │      │
│  │                ↕ postMessage                            │      │
│  └─────────────────┼────────────────────────────────────  │      │
│                    ↕                                        │      │
│  ┌─────────────────────────────────────────────────────┐  │      │
│  │         Worker Threads (4-8 threads)                │  │      │
│  │                                                     │  │      │
│  │  Worker 1    Worker 2    Worker 3    Worker 4      │  │      │
│  │  Download    Download    Download    Download      │  │      │
│  │  Validate    Validate    Validate    Validate      │  │      │
│  │  Upload      Upload      Upload      Upload        │  │      │
│  │     ↓            ↓            ↓            ↓        │  │      │
│  │  Complete    Complete    Complete    Complete      │  │      │
│  └─────────────────────────────────────────────────────┘  │      │
│                    ↓ reports completion                    │      │
│                    ↓ via postMessage                       │      │
└────────────────────┼───────────────────────────────────────────────┘
                     ↓
┌────────────────────┼───────────────────────────────────────────────┐
│                    ↓        DynamoDB JobState Table                │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │ jobId: "abc-123"                                         │     │
│  │ status: "DOWNLOADING"                                    │     │
│  │ taskToken: "AAAAKgAAAAIAAAAA..."                         │     │
│  │ totalTasks: 100                                          │     │
│  │ completedTasks: 47  ← Incremented atomically by workers │     │
│  │ failedTasks: 3      ← Incremented atomically by workers │     │
│  │ updatedAt: "2025-01-15T10:30:15Z"                        │     │
│  └──────────────────────────────────────────────────────────┘     │
│                    ↑ queried by                                    │
│                    ↑ Heartbeat Orchestrator                        │
└────────────────────────────────────────────────────────────────────┘
```

### Thread Interaction Sequence

```
Main Thread              Worker Thread 1         DynamoDB        Step Functions
    │                           │                    │                 │
    │                           │                    │                 │
    │── Assign Task ──→         │                    │                 │
    │   (postMessage)           │                    │                 │
    │                           │                    │                 │
    │                           │── Download ───────┐│                 │
    │                           │                   ││                 │
    │─── Query Jobs ────────────┼──────────────────→││                 │
    │                           │                   ││                 │
    │←── Job List ──────────────┼──────────────────●││                 │
    │    (status=DOWNLOADING)   │                   ││                 │
    │                           │                   ││                 │
    │─── Send Heartbeat ────────┼───────────────────┼┼────────────────→│
    │    (token=AAAAKg...)      │                   ││                 │
    │                           │                   ││                 │
    │                           │                   ││   ← Reset timer │
    │                           │                   ││                 │
    │                           │◀── Complete ──────┘│                 │
    │                           │                    │                 │
    │                           │── Validate ────────┐│                 │
    │                           │                    ││                 │
    │                           │── Upload ──────────┼┐                │
    │                           │                    │││                │
    │◀── TASK_COMPLETED ────────│                    │││                │
    │    (postMessage)          │                    │││                │
    │                           │                    │││                │
    │── Increment Counter ──────┼────────────────────→││                │
    │   (ADD completedTasks :1) │                    │││                │
    │                           │                    │││                │
    │◀── Updated Job ───────────┼────────────────────●││                │
    │                           │                    ││                │
    │                           │◀── Upload Done ────┘│                │
    │                           │                     │                │
    │── Assign Next Task ──→    │                     │                │
    │                           │                     │                │
    │                          ...                   ...               ...
    │                           │                     │                │
    │── Query Jobs ─────────────┼────────────────────→│                │
    │    (30s later)            │                     │                │
    │                           │                     │                │
    │←── Job List ──────────────┼────────────────────●│                │
    │    (updated progress)     │                     │                │
    │                           │                     │                │
    │─── Send Heartbeat ────────┼─────────────────────┼───────────────→│
    │                           │                     │                │
    │                           │                     │    ← Reset timer│
```

---

## Best Practices

### 1. Heartbeat Interval Configuration

**Recommendation**: Set heartbeat interval to **1/2 of Step Functions heartbeat timeout**

```
If Step Functions HeartbeatSeconds = 60s
Then STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS = 30000 (30s)
```

**Rationale**:
- Provides buffer for network latency and transient failures
- Allows one missed heartbeat without timeout
- Balances between API costs and reliability

### 2. Step Functions Timeout Configuration

**State Machine Definition:**
```json
{
  "Type": "Task",
  "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
  "TimeoutSeconds": 7200,      // 2 hours total timeout
  "HeartbeatSeconds": 60       // Expect heartbeat every 60 seconds
}
```

**Guidelines:**
- `TimeoutSeconds`: Maximum expected job duration + buffer (e.g., 2 hours for 100 files)
- `HeartbeatSeconds`: 2x your heartbeat interval (e.g., 60s if sending every 30s)
- Allow headroom for worker restarts and transient failures

### 3. Error Handling Strategy

**Heartbeat Failures Should Not Fail Jobs:**

```typescript
try {
  await this.stepFunctions.sendTaskHeartbeat(taskToken);
} catch (error) {
  // Log but don't throw - job processing continues
  this.logger.error(`Heartbeat failed: ${error.message}`);

  // Optionally: Emit metric for monitoring
  this.metrics.increment('heartbeat.failure');
}
```

**Rationale**:
- Heartbeat is a "liveness signal", not critical for correctness
- Worker processing should continue even if heartbeat fails
- Step Functions will eventually timeout if heartbeats repeatedly fail

### 4. Monitoring and Alerting

**Key Metrics:**

```typescript
// Heartbeat success rate
heartbeat.sent.total          // Counter: Total heartbeats attempted
heartbeat.success.total       // Counter: Successful heartbeats
heartbeat.failure.total       // Counter: Failed heartbeats

// Heartbeat latency
heartbeat.duration.ms         // Histogram: Time to send heartbeat

// Active jobs
jobs.active.with_token        // Gauge: Jobs requiring heartbeats
jobs.active.without_token     // Gauge: Jobs not requiring heartbeats
```

**CloudWatch Alarms:**

```yaml
Alarms:
  HeartbeatFailureRate:
    MetricName: heartbeat.failure.total
    Threshold: 5%  # Alert if >5% of heartbeats fail
    Period: 300    # 5 minutes

  StepFunctionsTimeouts:
    MetricName: stepfunctions.timeout.total
    Threshold: 1   # Alert on any timeout
    Period: 3600   # 1 hour

  HeartbeatLatency:
    MetricName: heartbeat.duration.ms
    Statistic: p99
    Threshold: 5000  # Alert if p99 > 5s
    Period: 300
```

### 5. DynamoDB Query Optimization

**Use Global Secondary Index (GSI):**

```typescript
// Without GSI: Scan entire table (slow, expensive)
const jobs = await dynamoDb.scan({
  FilterExpression: 'status = :status',
  ExpressionAttributeValues: { ':status': 'DOWNLOADING' }
});

// With GSI: Query by status (fast, cheap)
const jobs = await dynamoDb.query({
  IndexName: 'status-index',
  KeyConditionExpression: 'status = :status',
  ExpressionAttributeValues: { ':status': 'DOWNLOADING' }
});
```

**GSI Definition (CloudFormation/CDK):**
```yaml
GlobalSecondaryIndexes:
  - IndexName: status-index
    KeySchema:
      - AttributeName: status
        KeyType: HASH
      - AttributeName: updatedAt
        KeyType: RANGE
    Projection:
      ProjectionType: ALL
    ProvisionedThroughput:
      ReadCapacityUnits: 5
      WriteCapacityUnits: 5
```

### 6. Graceful Shutdown

**Ensure heartbeat loop stops cleanly:**

```typescript
async onModuleDestroy(): Promise<void> {
  this.logger.log('Stopping heartbeat orchestrator...');

  // Stop accepting new heartbeat cycles
  this.isRunning = false;

  // Clear interval
  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;
  }

  // Wait for in-flight heartbeats to complete
  await this.waitForInflightHeartbeats();

  this.logger.log('Heartbeat orchestrator stopped');
}
```

### 7. Testing Strategy

**Unit Tests:**
- Mock dependencies (JobRepository, StepFunctions)
- Test heartbeat sending logic
- Test error handling (TaskDoesNotExist, network failures)
- Test filtering (jobs with/without tokens)

**Integration Tests:**
- Use LocalStack for Step Functions
- Create actual state machine with `.waitForTaskToken`
- Send heartbeats and verify timeout doesn't occur
- Test timeout scenario when heartbeats stop

**Load Tests:**
- Simulate 100+ concurrent jobs
- Verify heartbeat orchestrator scales
- Monitor DynamoDB query performance
- Check Step Functions API rate limits

---

## Troubleshooting

### Common Issues and Solutions

#### 1. TaskDoesNotExist Error

**Error Message:**
```
Failed to send heartbeat: Task token has expired or does not exist
```

**Causes:**
- Token already used (job completed)
- State machine execution terminated
- Token from different AWS account/region
- Token expired (Step Functions timeout occurred)

**Solutions:**
```typescript
// Check job status before sending heartbeat
if (job.status === 'COMPLETED' || job.status === 'FAILED') {
  this.logger.debug(`Skipping heartbeat for ${job.status} job ${job.jobId}`);
  return;
}

// Gracefully handle TaskDoesNotExist
catch (error) {
  if (error.message.includes('TaskDoesNotExist')) {
    // Job likely completed - update local state
    await this.jobRepository.updateJobStatus(job.jobId, 'COMPLETED');
  }
}
```

#### 2. Heartbeat Interval Too Long

**Symptom:**
```
Step Functions execution timed out waiting for heartbeat
```

**Diagnosis:**
- Check `HeartbeatSeconds` in state machine (e.g., 60s)
- Check `STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS` (e.g., 30000ms = 30s)
- Verify heartbeat orchestrator is running

**Solution:**
```bash
# Reduce heartbeat interval to 1/2 of HeartbeatSeconds
# If HeartbeatSeconds = 60, set interval to 30s
STEP_FUNCTIONS_HEARTBEAT_INTERVAL_MS=30000
```

#### 3. No Heartbeats Being Sent

**Symptom:**
- Step Functions times out
- No heartbeat logs in application

**Diagnosis Checklist:**

```bash
# 1. Check heartbeat is enabled
echo $STEP_FUNCTIONS_HEARTBEAT_ENABLED  # Should be 'true'

# 2. Check orchestrator started
grep "Heartbeat orchestrator started" logs/*.log

# 3. Check jobs have task tokens
aws dynamodb scan \
  --table-name ExportJobs \
  --filter-expression "attribute_exists(taskToken)" \
  --projection-expression "jobId,status,taskToken"

# 4. Check jobs in DOWNLOADING status
aws dynamodb scan \
  --table-name ExportJobs \
  --filter-expression "#s = :status" \
  --expression-attribute-names '{"#s":"status"}' \
  --expression-attribute-values '{":status":{"S":"DOWNLOADING"}}'
```

**Common Fixes:**

```typescript
// Ensure findByStatus is implemented correctly
async findByStatus(status: string): Promise<ExportJobEntity[]> {
  const result = await this.dynamoDb.scan({
    FilterExpression: '#status = :status AND attribute_exists(taskToken)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
  });

  // ADD LOGGING
  this.logger.info(`Found ${result.Items?.length || 0} jobs with status ${status}`);

  return (result.Items || []).map(item => this.toEntity(item));
}
```

#### 4. High DynamoDB Costs

**Symptom:**
- DynamoDB costs increasing significantly
- Scan operations consuming many RCUs

**Diagnosis:**
```bash
# Check scan operations
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=ExportJobs \
  --start-time 2025-01-15T00:00:00Z \
  --end-time 2025-01-15T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

**Solution**: Create Global Secondary Index (GSI) on `status` field

```typescript
// Change from Scan to Query
async findByStatus(status: string): Promise<ExportJobEntity[]> {
  const result = await this.dynamoDb.query({
    IndexName: 'status-index',  // Use GSI instead of scan
    KeyConditionExpression: '#status = :status',
    FilterExpression: 'attribute_exists(taskToken)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status },
  });

  return (result.Items || []).map(item => this.toEntity(item));
}
```

#### 5. Heartbeat Orchestrator Not Starting

**Symptom:**
- Application starts but no heartbeat logs
- No "Heartbeat orchestrator started" message

**Diagnosis:**

```typescript
// Add explicit logging in onModuleInit
async onModuleInit(): Promise<void> {
  const enabled = this.configService.get('stepFunctions.heartbeatEnabled');

  this.logger.log(`Heartbeat config: enabled=${enabled}`);  // ADD THIS

  if (!enabled) {
    this.logger.warn('Heartbeat orchestrator DISABLED via configuration');
    return;
  }

  // ... rest of initialization
}
```

**Check module registration:**

```typescript
// In application.module.ts
@Module({
  providers: [
    // ... other providers
    HeartbeatOrchestratorService,  // MUST be listed here
  ],
})
export class ApplicationModule {}
```

#### 6. Memory Leak from Intervals

**Symptom:**
- Memory usage increases over time
- Interval keeps running after module destruction

**Solution:**

```typescript
private heartbeatInterval: NodeJS.Timeout | null = null;
private isRunning = false;

async onModuleDestroy(): Promise<void> {
  this.isRunning = false;  // Stop new cycles

  if (this.heartbeatInterval) {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = null;  // Clear reference
  }
}
```

**Verification:**

```bash
# Monitor memory over time
watch -n 10 'ps aux | grep node'

# Check for orphaned intervals
node --inspect dist/main.js
# In Chrome DevTools: Memory > Take Heap Snapshot
# Search for "Timeout" objects
```

---

## Summary

The Heartbeat Pattern enables robust, long-running export jobs by:

✅ **Preventing Timeout**: Regular heartbeats keep Step Functions tasks alive
✅ **Separation of Concerns**: Workers focus on processing, orchestrator handles coordination
✅ **Thread Safety**: DynamoDB provides atomic operations, no race conditions
✅ **Fault Tolerance**: Heartbeat failures don't affect job processing
✅ **Scalability**: Single orchestrator monitors all jobs efficiently
✅ **Observability**: Comprehensive logging and metrics for monitoring

**Key Implementation Points:**
- Orchestrator sends heartbeats every 30s (configurable)
- Workers report progress to DynamoDB independently
- DynamoDB is single source of truth (atomic counters)
- No shared memory between threads (message passing only)
- Graceful error handling (heartbeat failures logged, not thrown)
- GSI on status field for efficient queries

**Related Documentation:**
- [STEP_FUNCTIONS_INTEGRATION.md](STEP_FUNCTIONS_INTEGRATION.md) - Step Functions integration guide
- [HEXAGONAL_ARCHITECTURE.md](HEXAGONAL_ARCHITECTURE.md) - Architecture patterns and principles
- [MODULE_SETUP_GUIDE.md](MODULE_SETUP_GUIDE.md) - NestJS module configuration
