# ATDD Quick Start Guide

## Run Your First Test

```bash
# Run all ATDD tests
npm run test:atdd

# Run in watch mode (auto-rerun on file changes)
npm run test:atdd:watch

# Run specific feature
npx cucumber-js test/acceptance/features/start-export-job.feature

# Run specific scenario (by line number)
npx cucumber-js test/acceptance/features/start-export-job.feature:8
```

## Create Your First Test

### 1. Create a Feature File

Create `test/acceptance/features/my-feature.feature`:

```gherkin
Feature: My New Feature
  As a user
  I want to do something
  So that I achieve a goal

  Scenario: My first scenario
    Given a job exists
    When I execute an action
    Then I should see the expected result
```

### 2. Run Cucumber to Generate Step Snippets

```bash
npm run test:atdd
```

Cucumber will show you undefined step snippets like:

```typescript
Given('a job exists', async function () {
  // Write code here that turns the phrase above into concrete actions
  return 'pending';
});
```

### 3. Create Step Definitions

Create `test/acceptance/step-definitions/my-feature-steps.ts`:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { Test } from '@nestjs/testing';
import { expect } from '@jest/globals';
import { ExportJobWorld } from '../support/world';

// Your use case import
import { MyUseCase } from '../../../src/application/use-cases/my.use-case';

// In-memory adapters
import { InMemoryJobRepositoryAdapter } from '../../in-memory-adapters';

// Shared instances
let jobRepository: InMemoryJobRepositoryAdapter;

Given('a job exists', async function (this: ExportJobWorld) {
  // Initialize adapters
  jobRepository = new InMemoryJobRepositoryAdapter();

  // Create NestJS testing module
  this.context.testingModule = await Test.createTestingModule({
    providers: [
      MyUseCase,
      {
        provide: 'JobStateRepositoryPort',
        useValue: jobRepository,
      },
    ],
  }).compile();

  // Create and save a job
  // ... your setup code
});

When('I execute an action', async function (this: ExportJobWorld) {
  const useCase = this.context.testingModule!.get(MyUseCase);
  this.context.lastResult = await useCase.execute({ /* command */ });
});

Then('I should see the expected result', function (this: ExportJobWorld) {
  expect(this.context.lastResult).toBeDefined();
  // Your assertions
});
```

### 4. Run Your Test

```bash
npm run test:atdd
```

## Common Patterns

### Setting Up Test Data

```typescript
Given('a job {string} with {int} tasks', async function (
  this: ExportJobWorld,
  jobId: string,
  totalTasks: number
) {
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
});
```

### Executing Use Cases

```typescript
When('I start a job with {string}', async function (
  this: ExportJobWorld,
  jobId: string
) {
  const useCase = this.context.testingModule!.get(StartExportJobUseCase);

  try {
    this.context.lastResult = await useCase.execute({ jobId });
  } catch (error) {
    this.context.lastError = error as Error;
  }
});
```

### Making Assertions

```typescript
Then('the job status should be {string}', function (
  this: ExportJobWorld,
  expectedStatus: string
) {
  expect(this.context.currentJob).toBeDefined();
  expect(this.context.currentJob!.jobState.status).toBe(expectedStatus);
});
```

### Verifying Events

```typescript
Then('a {string} event should be published', function (
  this: ExportJobWorld,
  eventType: string
) {
  const events = eventPublisher.getEventsByType(eventType);
  expect(events.length).toBeGreaterThan(0);
});
```

### Using Data Tables

Feature file:
```gherkin
When I start a job with:
  | jobId    | job-001 |
  | exportId | exp-001 |
  | userId   | user-1  |
```

Step definition:
```typescript
When('I start a job with:', async function (
  this: ExportJobWorld,
  dataTable: DataTable
) {
  const data = dataTable.rowsHash();
  // data.jobId, data.exportId, data.userId
});
```

## Available In-Memory Adapters

All adapters are imported from `test/in-memory-adapters/index.ts`:

```typescript
import {
  InMemoryJobRepositoryAdapter,
  InMemoryExportApiAdapter,
  InMemoryFileStorageAdapter,
  InMemoryMessageQueueAdapter,
  InMemoryWorkerPoolAdapter,
  InMemoryEventPublisherAdapter,
  InMemoryStepFunctionsAdapter,
} from '../../in-memory-adapters';
```

### Configure Export API Behavior

```typescript
// Export is immediately ready
exportApi.createMockExport(exportId, userId, ExportStatusVO.READY, downloadUrls);

// Export needs polling (becomes ready after N polls)
exportApi.configureExportToTransition(exportId, 3, downloadUrls);

// Export will fail
exportApi.configureExportAsFailed(exportId, 'Error message');
```

### Configure Worker Pool

```typescript
// Set maximum workers
workerPool.setMaxWorkers(10);

// Set processing delay (ms)
workerPool.setProcessingDelay(100);

// Set failure rate (0.0 to 1.0)
workerPool.setFailureRate(0.2); // 20% failure
```

### Query Adapters for Assertions

```typescript
// Job repository
const job = await jobRepository.findById(jobId);
const allJobs = jobRepository.getAllJobs();
const jobCount = jobRepository.getJobCount();

// Event publisher
const events = eventPublisher.getEventsByType('JobCreated');
const eventCount = eventPublisher.getEventCount();
const hasEvent = eventPublisher.hasEventType('JobFailed');

// Step Functions
const wasSuccessful = stepFunctions.wasSuccessSent(taskToken);
const output = stepFunctions.getSuccessOutput(taskToken);
```

## Test Context (World)

The `ExportJobWorld` provides helper methods:

```typescript
// Job management
this.setJob(job);              // Set current job
this.getJob(jobId);            // Get job by ID
this.context.currentJob;       // Access current job

// Event management
this.addEvent(event);          // Add event
this.getEventsByType('Type');  // Get events by type
this.context.publishedEvents;  // All events

// Result tracking
this.context.lastResult;       // Last use case result
this.context.lastError;        // Last error (if any)

// Export API simulation
this.setExportApiResponse(exportId, response);

// File storage
this.storeFile(key, buffer, metadata);
this.getFile(key);

// Message queue
this.queueMessage(queueUrl, message);
this.getQueuedMessages(queueUrl);
```

## Debugging Tests

### Enable Verbose Output

```bash
npx cucumber-js --format progress-bar
```

### Run Single Scenario

```bash
npx cucumber-js test/acceptance/features/start-export-job.feature:15
```

### Add Console Logs

```typescript
When('debugging step', function (this: ExportJobWorld) {
  console.log('Current job:', this.context.currentJob);
  console.log('Last result:', this.context.lastResult);
  console.log('Events:', this.context.publishedEvents);
});
```

### Check Hooks Output

Failures are automatically logged in the `After` hook (see `test/acceptance/support/hooks.ts`).

## Best Practices

1. **Keep scenarios independent** - Don't rely on previous scenario state
2. **Use descriptive scenario names** - Name should explain what you're testing
3. **One assertion per Then** - Keep Then steps focused
4. **Reuse step definitions** - Share common steps across features
5. **Test domain behavior** - Focus on business logic, not implementation
6. **Verify events** - Always check that domain events are published
7. **Test edge cases** - Empty states, boundaries, failures

## Example: Complete Test Workflow

```gherkin
Feature: Export Job Completion

  Scenario: Successfully complete job with all tasks
    # Setup
    Given the export service is initialized
    And a job "job-001" exists with 3 total tasks
    And the job has 0 completed tasks and 0 failed tasks

    # Execute
    When I complete task "task-001" for job "job-001" with success
    And I complete task "task-002" for job "job-001" with success
    And I complete task "task-003" for job "job-001" with success

    # Verify
    Then the job should have 3 completed tasks
    And the job should have 0 failed tasks
    And the job should be marked as complete
    And the job status should be "COMPLETED"
    And all tasks should have succeeded
    And a "JobCompleted" event should be published
    And exactly 3 "TaskCompleted" events should be published
```

## Need Help?

- Read the [main README](README.md)
- Check [example features](features/)
- Review [step definitions](../step-definitions/)
- Examine [in-memory adapters](../../in-memory-adapters/)
- Consult [Cucumber docs](https://cucumber.io/docs/cucumber/)

Happy testing! 🥒
