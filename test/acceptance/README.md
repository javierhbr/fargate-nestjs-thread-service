# ATDD Test Suite - Export Job Service

This directory contains Acceptance Test-Driven Development (ATDD) tests using Cucumber and TypeScript for the Export Job Service. These tests validate business logic in isolation using in-memory adapter implementations of the hexagonal architecture ports.

## Overview

The ATDD test suite provides:

- **Business-readable scenarios** using Gherkin syntax
- **Pure business logic testing** without external dependencies (AWS, databases, APIs)
- **Fast execution** with in-memory adapters
- **Domain invariant validation** ensuring value objects and entities maintain consistency
- **Event verification** confirming domain events are published correctly
- **Complete workflow testing** from job creation to completion

## Architecture

### Hexagonal Architecture Testing

```
┌─────────────────────────────────────────────────────────────────┐
│                        ATDD Test Layer                          │
├─────────────────────────────────────────────────────────────────┤
│  Feature Files (Gherkin)  │  Step Definitions (TypeScript)      │
│  *.feature                │  *-steps.ts                         │
└─────────────────┬─────────────────────────────────┬─────────────┘
                  │                                 │
                  ▼                                 ▼
         ┌─────────────────┐            ┌──────────────────────┐
         │   Use Cases     │            │  In-Memory Adapters  │
         │   (Domain)      │◄───────────│  (Test Doubles)      │
         └─────────────────┘            └──────────────────────┘
                  │
                  ▼
         ┌─────────────────┐
         │ Domain Entities │
         │  Value Objects  │
         │     Events      │
         └─────────────────┘
```

### In-Memory Adapters

All external dependencies are replaced with in-memory implementations:

| Port | In-Memory Adapter | Purpose |
|------|-------------------|---------|
| `JobStateRepositoryPort` | `InMemoryJobRepositoryAdapter` | Store jobs in Map |
| `ExportApiPort` | `InMemoryExportApiAdapter` | Simulate export API responses |
| `FileStoragePort` | `InMemoryFileStorageAdapter` | Store files in Buffer |
| `MessageQueuePort` | `InMemoryMessageQueueAdapter` | Queue messages in Array |
| `WorkerPoolPort` | `InMemoryWorkerPoolAdapter` | Simulate worker processing |
| `EventPublisherPort` | `InMemoryEventPublisherAdapter` | Capture events for verification |
| `StepFunctionsPort` | `InMemoryStepFunctionsAdapter` | Capture callbacks |

## Directory Structure

```
test/acceptance/
├── features/                           # Gherkin feature files
│   ├── start-export-job.feature        # Start job scenarios
│   ├── complete-job.feature            # Job completion scenarios
│   └── end-to-end-export-workflow.feature  # Full workflow tests
├── step-definitions/                   # Step implementations
│   ├── start-export-job-steps.ts
│   ├── complete-job-steps.ts
│   └── end-to-end-steps.ts
├── support/                            # Test infrastructure
│   ├── world.ts                        # Cucumber World context
│   └── hooks.ts                        # Before/After hooks
└── fixtures/                           # Test data
    ├── jobs/
    ├── tasks/
    └── files/

test/in-memory-adapters/                # In-memory implementations
├── in-memory-job-repository.adapter.ts
├── in-memory-export-api.adapter.ts
├── in-memory-file-storage.adapter.ts
├── in-memory-message-queue.adapter.ts
├── in-memory-worker-pool.adapter.ts
├── in-memory-event-publisher.adapter.ts
├── in-memory-step-functions.adapter.ts
└── index.ts
```

## Running Tests

### Run all ATDD tests
```bash
npm run test:atdd
```

### Run tests in watch mode
```bash
npm run test:atdd:watch
```

### Run specific feature file
```bash
npx cucumber-js test/acceptance/features/start-export-job.feature
```

### Run specific scenario by line number
```bash
npx cucumber-js test/acceptance/features/start-export-job.feature:15
```

## Writing Tests

### Feature File Structure

Feature files use Gherkin syntax with Given-When-Then steps:

```gherkin
Feature: Job Completion
  As a system
  I want to track task completion
  So that I can finalize export jobs

  Scenario: Task completes successfully
    Given a job "job-001" exists with 3 total tasks
    And the job has 0 completed tasks and 0 failed tasks
    When I complete task "task-001" for job "job-001" with success
    Then the job should have 1 completed tasks
    And the job should not be marked as complete
    And a "TaskCompleted" event should be published
```

### Step Definitions

Step definitions implement the Gherkin steps in TypeScript:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { ExportJobWorld } from '../support/world';

Given('a job {string} exists with {int} total tasks',
  async function (this: ExportJobWorld, jobId: string, totalTasks: number) {
    // Create job entity
    const job = new ExportJobEntity(jobId, 'export-id', 'user-id', {
      status: JobStatusVO.DOWNLOADING,
      totalTasks,
      completedTasks: 0,
      failedTasks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await jobRepository.save(job);
    this.setJob(job);
  }
);
```

### Test Context (World)

The `ExportJobWorld` class maintains state between steps:

```typescript
export class ExportJobWorld extends World {
  public context: TestContext;

  // Helper methods
  setJob(job: ExportJobEntity): void;
  getJob(jobId: string): ExportJobEntity | undefined;
  addEvent(event: DomainEvent): void;
  getEventsByType<T extends DomainEvent>(eventType: string): T[];
  // ... more helpers
}
```

## Test Patterns

### 1. Testing Use Cases

```gherkin
Scenario: Start export job
  Given an export "export-123" is READY
  When I start an export job with:
    | jobId    | job-001    |
    | exportId | export-123 |
    | userId   | user-456   |
  Then the job should be created successfully
  And the job status should be "DOWNLOADING"
```

### 2. Validating Domain Events

```gherkin
Then a "JobCreated" event should be published
And a "JobCompleted" event should be published
And exactly 2 "TaskCompleted" events should be published
```

### 3. Testing State Transitions

```gherkin
Given the job status is "POLLING"
When the export becomes READY
Then the job status should transition to "DOWNLOADING"
```

### 4. Verifying Invariants

```gherkin
Then the job should have valid state:
  | totalTasks     | 3 |
  | completedTasks | 2 |
  | failedTasks    | 1 |
And the job state invariants should be valid
```

### 5. Testing Edge Cases

```gherkin
Scenario: Export has expired
  Given an export has EXPIRED
  When I start an export job
  Then the job status should be "FAILED"
  And the job should have error message containing "expired"
```

## Key Testing Scenarios

### Start Export Job
- ✅ Export immediately ready
- ✅ Export needs polling
- ✅ Export already failed
- ✅ Export expired
- ✅ Custom metadata handling
- ✅ Step Functions task token

### Complete Job
- ✅ Task completion tracking
- ✅ Job completion detection
- ✅ Partial failure handling
- ✅ Step Functions callbacks
- ✅ Concurrent task completion
- ✅ Event publishing

### End-to-End Workflows
- ✅ Complete workflow with immediate success
- ✅ Workflow with polling
- ✅ Workflow with partial failures
- ✅ Workflow with complete failure
- ✅ Domain invariant validation

## In-Memory Adapter Features

### Configurable Behavior

The in-memory adapters support test configuration:

```typescript
// Configure export API to transition after N polls
exportApi.configureExportToTransition(exportId, 3, downloadUrls);

// Configure export to fail
exportApi.configureExportAsFailed(exportId, 'Error message');

// Configure worker pool capacity
workerPool.setMaxWorkers(5);

// Set failure rate for testing error handling
workerPool.setFailureRate(0.2); // 20% failure rate
```

### Test Assertions

In-memory adapters provide assertion helpers:

```typescript
// Job repository
jobRepository.getJobCount();
jobRepository.getAllJobs();

// Event publisher
eventPublisher.getEventsByType('JobCompleted');
eventPublisher.getEventCount();
eventPublisher.hasEventType('JobFailed');

// Step Functions
stepFunctions.wasSuccessSent(taskToken);
stepFunctions.getSuccessOutput(taskToken);
```

## Benefits of ATDD Approach

1. **Fast Execution**: No network calls, no AWS services, runs in milliseconds
2. **Reliable**: No flaky tests due to external service issues
3. **Isolated**: Tests only business logic, not infrastructure
4. **Readable**: Gherkin scenarios are understandable by non-developers
5. **Living Documentation**: Feature files document system behavior
6. **Early Feedback**: Catch domain logic bugs before integration testing
7. **Refactoring Safety**: Tests verify behavior, not implementation

## Best Practices

1. **Keep scenarios focused**: One scenario tests one behavior
2. **Use descriptive names**: Scenarios should be self-explanatory
3. **Test domain invariants**: Validate value object constraints
4. **Verify events**: Ensure domain events are published correctly
5. **Test edge cases**: Expired exports, failures, concurrent operations
6. **Maintain independence**: Each scenario should be independent
7. **Clean state**: Use hooks to reset adapters between scenarios

## Troubleshooting

### Tests fail with "Module not found"

Ensure TypeScript paths are configured correctly in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### Step definitions not found

Verify `cucumber.config.ts` has correct paths:

```typescript
require: [
  'test/acceptance/step-definitions/**/*.ts',
  'test/acceptance/support/**/*.ts',
]
```

### Type errors in step definitions

Import `ExportJobWorld` and use it as `this` context:

```typescript
import { ExportJobWorld } from '../support/world';

When('I do something', async function (this: ExportJobWorld) {
  // Access: this.context
});
```

## Next Steps

To extend the ATDD test suite:

1. **Add more use case scenarios**: Poll Export Status, Dispatch Download Tasks, Process File
2. **Add error scenarios**: Network failures, timeouts, validation errors
3. **Add performance tests**: Large file counts, concurrent operations
4. **Add integration scenarios**: Multiple jobs, queue overflow, retry logic
5. **Generate reports**: HTML reports with screenshots of failures

## References

- [Cucumber Documentation](https://cucumber.io/docs/cucumber/)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
- [ATDD Best Practices](https://cucumber.io/docs/bdd/)
- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
