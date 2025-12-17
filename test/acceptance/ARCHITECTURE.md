# ATDD Architecture Overview

## Hexagonal Architecture with ATDD

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ATDD Test Layer                                │
│                                                                             │
│  ┌─────────────────┐                    ┌─────────────────────────────┐   │
│  │  Feature Files  │                    │   Step Definitions          │   │
│  │   (Gherkin)     │────────────────────│   (TypeScript)              │   │
│  │                 │  Human-readable    │                             │   │
│  │  *.feature      │  scenarios         │  *-steps.ts                 │   │
│  └─────────────────┘                    └──────────┬──────────────────┘   │
│                                                     │                       │
└─────────────────────────────────────────────────────┼───────────────────────┘
                                                      │
                                                      │ Uses
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Application Layer (Use Cases)                      │
│                                                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐    │
│  │ StartExportJob   │  │ PollExportStatus │  │ CompleteJob          │    │
│  │ UseCase          │  │ UseCase          │  │ UseCase              │    │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
           │                                              │
           │ Depends on (Ports)                          │
           ▼                                              ▼
┌─────────────────────────┐                   ┌─────────────────────────────┐
│    Input Ports          │                   │     Output Ports            │
│  (Driving Adapters)     │                   │   (Driven Adapters)         │
│                         │                   │                             │
│  Commands & Results     │                   │  Repository, API, Storage   │
└─────────────────────────┘                   └─────────────┬───────────────┘
                                                            │
                                              ATDD Tests    │    Production
                                              Use ──────────┼──────── Uses
                                                            │
                                              ┌─────────────▼────────────────┐
                                              │                              │
                                   ┌──────────┴──────────┐    ┌─────────────▼─────────┐
                                   │  In-Memory Adapters │    │   Real Adapters       │
                                   │  (Test Doubles)     │    │   (Infrastructure)    │
                                   │                     │    │                       │
                                   │  • InMemoryJobRepo  │    │  • DynamoDBJobRepo    │
                                   │  • InMemoryExportAPI│    │  • HTTPExportAPI      │
                                   │  • InMemoryS3       │    │  • S3FileStorage      │
                                   │  • InMemoryQueue    │    │  • SQSMessageQueue    │
                                   │  • InMemoryWorkers  │    │  • WorkerThreadPool   │
                                   │  • InMemoryEvents   │    │  • EventBridgePublish │
                                   │  • InMemoryStepFns  │    │  • StepFunctionsAPI   │
                                   └─────────────────────┘    └───────────────────────┘
                                            ▲                          ▲
                                            │                          │
                                            └──────────────┬───────────┘
                                                          │
                                        Same Interface (Port)
                                        Different Implementation
```

## Test Flow

```
1. Write Feature                2. Cucumber Parses           3. Execute Steps
   (Gherkin)                       & Matches                    (TypeScript)

┌─────────────────┐           ┌──────────────┐            ┌─────────────────┐
│ Given a job     │           │  Find Given  │            │ Create job      │
│ When I complete │  ──────►  │  Find When   │  ──────►   │ Execute use case│
│ Then status is  │           │  Find Then   │            │ Assert result   │
└─────────────────┘           └──────────────┘            └─────────────────┘
                                                                   │
                                                                   ▼
                                                          ┌─────────────────┐
                                                          │ Use In-Memory   │
                                                          │ Adapters        │
                                                          │ (No AWS!)       │
                                                          └─────────────────┘
```

## Domain Testing Strategy

```
                           ┌─────────────────────────────┐
                           │    Business Logic Tests     │
                           │         (ATDD)              │
                           └──────────────┬──────────────┘
                                          │
                           ┌──────────────▼──────────────┐
                           │   Test Domain Entities      │
                           │   • State Transitions       │
                           │   • Invariants              │
                           │   • Business Rules          │
                           └──────────────┬──────────────┘
                                          │
                 ┌────────────────────────┼────────────────────────┐
                 │                        │                        │
        ┌────────▼────────┐    ┌─────────▼─────────┐    ┌────────▼────────┐
        │ Value Objects   │    │  Domain Entities  │    │  Domain Events  │
        │                 │    │                   │    │                 │
        │ • JobStatusVO   │    │ • ExportJobEntity │    │ • JobCreated    │
        │ • JobStateVO    │    │ • DownloadTask    │    │ • JobCompleted  │
        │ • ExportStatus  │    │                   │    │ • TaskCompleted │
        │ • FileMetadata  │    │                   │    │ • JobFailed     │
        └─────────────────┘    └───────────────────┘    └─────────────────┘
             │                          │                        │
             │                          │                        │
             └──────────────────────────┼────────────────────────┘
                                        │
                                        ▼
                           ┌─────────────────────────┐
                           │  Validated by ATDD      │
                           │  • Invariants hold      │
                           │  • Events published     │
                           │  • State valid          │
                           └─────────────────────────┘
```

## In-Memory Adapter Pattern

Each adapter implements a port interface and provides test helpers:

```
┌─────────────────────────────────────────────────────────────┐
│              InMemoryJobRepositoryAdapter                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Implements: JobStateRepositoryPort                         │
│                                                             │
│  Storage:    Map<string, ExportJobEntity>                   │
│                                                             │
│  Port Methods (Required):                                   │
│    • save(job)                                              │
│    • findById(jobId)                                        │
│    • updateJobState(jobId, state)                           │
│    • incrementCompletedTasks(jobId)                         │
│    • incrementFailedTasks(jobId)                            │
│    • setTotalTasks(jobId, count)                            │
│    • delete(jobId)                                          │
│    • findByStatus(status, limit)                            │
│                                                             │
│  Test Helpers (Extra):                                      │
│    • clear()                    // Reset state              │
│    • getAllJobs()               // Get all for assertions   │
│    • getJobCount()              // Count jobs               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Test Execution Flow

```
1. Scenario Starts
   │
   ├─► Before Hook
   │   └─► Reset ExportJobWorld context
   │
   ├─► Given Steps (Setup)
   │   ├─► Initialize in-memory adapters
   │   ├─► Create NestJS testing module
   │   ├─► Configure mock data
   │   └─► Set up test fixtures
   │
   ├─► When Steps (Execute)
   │   ├─► Get use case from module
   │   ├─► Execute with command
   │   ├─► Store result in context
   │   └─► Catch any errors
   │
   ├─► Then Steps (Assert)
   │   ├─► Verify result values
   │   ├─► Check domain state
   │   ├─► Validate events published
   │   └─► Confirm invariants
   │
   └─► After Hook
       ├─► Close testing module
       ├─► Log failures (if any)
       └─► Clean up resources
```

## Benefits Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Traditional Testing                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tests ──► Use Case ──► AWS DynamoDB                            │
│                    ├──► AWS S3                                  │
│                    ├──► AWS SQS                                 │
│                    ├──► AWS Step Functions                      │
│                    └──► External API                            │
│                                                                 │
│  Issues:                                                        │
│    ❌ Slow (network calls)                                      │
│    ❌ Flaky (network issues)                                    │
│    ❌ Expensive (AWS costs)                                     │
│    ❌ Complex setup (infrastructure)                            │
│    ❌ Environment pollution (test data)                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      ATDD Testing (This Setup)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tests ──► Use Case ──► InMemoryJobRepository                   │
│                    ├──► InMemoryExportAPI                       │
│                    ├──► InMemoryFileStorage                     │
│                    ├──► InMemoryMessageQueue                    │
│                    ├──► InMemoryWorkerPool                      │
│                    ├──► InMemoryEventPublisher                  │
│                    └──► InMemoryStepFunctions                   │
│                                                                 │
│  Benefits:                                                      │
│    ✅ Fast (in-memory only)                                     │
│    ✅ Reliable (no network)                                     │
│    ✅ Free (no AWS)                                             │
│    ✅ Simple setup (just npm install)                           │
│    ✅ Clean (no pollution)                                      │
│    ✅ Testable (full control)                                   │
│    ✅ Portable (runs anywhere)                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Test Coverage Map

```
Use Cases Covered:
├── ✅ StartExportJobUseCase
│   ├── Export immediately ready
│   ├── Export needs polling
│   ├── Export already failed
│   ├── Export expired
│   └── Step Functions integration
│
├── ✅ CompleteJobUseCase
│   ├── Task completion tracking
│   ├── Job completion detection
│   ├── Partial failure handling
│   ├── Step Functions callbacks
│   └── Concurrent tasks
│
└── 🔄 Additional Use Cases (TODO)
    ├── ⏳ PollExportStatusUseCase
    ├── ⏳ DispatchDownloadTasksUseCase
    └── ⏳ ProcessFileUseCase

Domain Coverage:
├── ✅ ExportJobEntity
│   ├── State transitions
│   ├── Task counter management
│   └── Metadata handling
│
├── ✅ JobStateVO
│   ├── Invariant validation
│   ├── Status transitions
│   └── Timestamp tracking
│
└── ✅ Domain Events
    ├── JobCreated
    ├── JobCompleted
    ├── JobFailed
    ├── TaskCompleted
    └── TaskFailed
```

## Component Interaction

```
┌─────────────┐
│ Cucumber    │  Reads feature files
│ Test Runner │  Matches step definitions
└──────┬──────┘  Executes scenarios
       │
       ▼
┌─────────────────────────────────────────┐
│        ExportJobWorld                   │
│  (Test Context & State Management)      │
│                                         │
│  • testingModule: NestJS TestModule    │
│  • currentJob: ExportJobEntity         │
│  • lastResult: Use case result         │
│  • publishedEvents: DomainEvent[]      │
│  • Helper methods for assertions       │
└─────────┬───────────────────────────────┘
          │
          │ Creates
          ▼
┌─────────────────────────────────────────┐
│      NestJS Testing Module              │
│                                         │
│  Providers:                             │
│    • Use Cases (business logic)         │
│    • In-Memory Adapters (test doubles) │
│                                         │
│  Dependency Injection:                  │
│    Port interfaces → Adapter instances  │
└─────────┬───────────────────────────────┘
          │
          │ Injects into
          ▼
┌─────────────────────────────────────────┐
│         Use Case                        │
│                                         │
│  constructor(                           │
│    @Inject('JobRepo') repo,            │
│    @Inject('ExportAPI') api,           │
│    @Inject('EventPub') events          │
│  ) {}                                   │
│                                         │
│  async execute(command) {               │
│    // Business logic only               │
│    // Uses injected adapters            │
│  }                                      │
└─────────┬───────────────────────────────┘
          │
          │ Uses
          ▼
┌─────────────────────────────────────────┐
│      In-Memory Adapters                 │
│                                         │
│  No AWS, No Network, No Database        │
│  Pure in-memory data structures         │
│  Configurable behavior for tests        │
│  Rich assertion helpers                 │
└─────────────────────────────────────────┘
```

## Summary

This ATDD architecture enables:

1. **Pure business logic testing** - No infrastructure concerns
2. **Fast feedback** - Tests run in milliseconds
3. **Reliable results** - No network or external dependencies
4. **Easy debugging** - Full control over test data
5. **Living documentation** - Gherkin scenarios describe behavior
6. **Refactoring safety** - Tests verify behavior, not implementation
7. **Hexagonal architecture** - True port/adapter separation

The key insight: **By testing through ports with in-memory adapters, we verify business logic in complete isolation while maintaining the same interfaces used in production.**
