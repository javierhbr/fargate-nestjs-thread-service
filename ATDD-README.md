# ATDD with TypeScript, Cucumber, and In-Memory Adapters

## Table of Contents

1. [Introduction](#introduction)
2. [Architecture Overview](#architecture-overview)
3. [Setup and Installation](#setup-and-installation)
4. [Project Structure](#project-structure)
5. [Writing Feature Files](#writing-feature-files)
6. [Implementing Step Definitions](#implementing-step-definitions)
7. [In-Memory Adapters](#in-memory-adapters)
8. [Test Context and World](#test-context-and-world)
9. [Running Tests](#running-tests)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)
12. [Advanced Patterns](#advanced-patterns)

---

## Introduction

### What is ATDD?

**Acceptance Test-Driven Development (ATDD)** is a collaborative approach where:
- Business stakeholders, developers, and testers define acceptance criteria together
- Tests are written **before** implementation
- Tests serve as living documentation
- Focus is on business behavior, not technical implementation

### Why Cucumber with TypeScript?

- **Gherkin syntax**: Human-readable Given/When/Then format
- **Type safety**: TypeScript catches errors at compile time
- **Domain focus**: Tests verify business logic without external dependencies
- **Fast feedback**: In-memory adapters make tests run in milliseconds

### Why In-Memory Adapters?

In-memory adapters implement port interfaces without actual infrastructure:
- ✅ No AWS services required (DynamoDB, S3, SQS, Step Functions)
- ✅ Tests run 100x faster
- ✅ Deterministic behavior (no network issues)
- ✅ Easy to set up complex scenarios
- ✅ Perfect for CI/CD pipelines

---

## Architecture Overview

This project follows **Hexagonal Architecture** (Ports and Adapters):

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Core                       │
│  ┌─────────────┐         ┌──────────────┐                  │
│  │   Domain    │         │  Use Cases   │                  │
│  │  Entities   │◄────────┤              │                  │
│  │  Value Obj  │         │ Business     │                  │
│  │  Events     │         │ Logic        │                  │
│  └─────────────┘         └──────┬───────┘                  │
│                                  │                           │
│                          ┌───────▼────────┐                 │
│                          │  Input Ports   │                 │
│                          │ (Interfaces)   │                 │
│                          └───────┬────────┘                 │
└──────────────────────────────────┼──────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                           │
        │                  ┌───────▼────────┐                 │
        │                  │  Output Ports  │                 │
        │                  │  (Interfaces)  │                 │
        │                  └───────┬────────┘                 │
        │                          │                           │
        │         ┌────────────────┴────────────────┐         │
        │         │                                  │         │
┌───────▼─────────▼────┐                   ┌────────▼─────────▼───────┐
│  Production Adapters │                   │  In-Memory Test Adapters │
│  • DynamoDB          │                   │  • InMemoryJobRepository │
│  • S3                │                   │  • InMemoryExportApi     │
│  • SQS               │                   │  • InMemoryEventPublisher│
│  • Step Functions    │                   │  • InMemoryStepFunctions │
└──────────────────────┘                   └──────────────────────────┘
```

### Key Principles

1. **Domain Layer**: Pure business logic, no infrastructure dependencies
2. **Input Ports**: Define what the application can do (use cases)
3. **Output Ports**: Define what the application needs (repositories, APIs)
4. **Adapters**: Implement ports for specific technologies
5. **Tests**: Use in-memory adapters to test business logic in isolation

---

## Setup and Installation

### 1. Install Dependencies

```bash
# Core Cucumber dependencies
npm install --save-dev @cucumber/cucumber @cucumber/cucumber-expressions

# TypeScript support
npm install --save-dev ts-node tsconfig-paths

# Assertion library (CommonJS compatible)
npm install --save-dev chai@4 @types/chai
```

### 2. Create Cucumber Configuration

**cucumber.config.js** (must be CommonJS, not TypeScript):

```javascript
module.exports = {
  default: {
    // Where to find feature files
    paths: ['test/acceptance/features/**/*.feature'],

    // Where to find step definitions and support files
    require: [
      'test/acceptance/step-definitions/**/*.ts',
      'test/acceptance/support/**/*.ts',
    ],

    // TypeScript compilation
    requireModule: ['ts-node/register', 'tsconfig-paths/register'],

    // Output format
    format: [
      'progress-bar',                                    // Console output
      'html:test/reports/cucumber-report.html',         // HTML report
    ],

    // Suppress warnings
    publishQuiet: true,
  },
};
```

### 3. Create TypeScript Configuration for Cucumber

**tsconfig.cucumber.json**:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",              // Required for Cucumber
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": [
    "test/acceptance/**/*.ts",
    "test/in-memory-adapters/**/*.ts"
  ]
}
```

### 4. Add NPM Scripts

**package.json**:

```json
{
  "scripts": {
    "test:atdd": "TS_NODE_PROJECT=tsconfig.cucumber.json cucumber-js --config cucumber.config.js",
    "test:atdd:watch": "TS_NODE_PROJECT=tsconfig.cucumber.json cucumber-js --config cucumber.config.js --watch",
    "test:atdd:tag": "TS_NODE_PROJECT=tsconfig.cucumber.json cucumber-js --config cucumber.config.js --tags"
  }
}
```

---

## Project Structure

```
project-root/
├── src/                                    # Production code
│   ├── application/
│   │   ├── ports/
│   │   │   ├── input/                      # Use case interfaces
│   │   │   │   ├── start-export-job.port.ts
│   │   │   │   ├── complete-job.port.ts
│   │   │   │   └── poll-export-status.port.ts
│   │   │   └── output/                     # Infrastructure interfaces
│   │   │       ├── job-state-repository.port.ts
│   │   │       ├── export-api.port.ts
│   │   │       ├── event-publisher.port.ts
│   │   │       └── step-functions.port.ts
│   │   └── use-cases/                      # Business logic
│   │       ├── start-export-job.use-case.ts
│   │       ├── complete-job.use-case.ts
│   │       └── poll-export-status.use-case.ts
│   ├── domain/
│   │   ├── entities/                       # Domain entities
│   │   │   ├── export-job.entity.ts
│   │   │   └── download-task.entity.ts
│   │   ├── value-objects/                  # Value objects
│   │   │   ├── job-status.vo.ts
│   │   │   ├── job-state.vo.ts
│   │   │   └── export-status.vo.ts
│   │   └── events/                         # Domain events
│   │       ├── base.event.ts
│   │       ├── job-created.event.ts
│   │       ├── job-completed.event.ts
│   │       ├── job-failed.event.ts
│   │       ├── task-completed.event.ts
│   │       └── task-failed.event.ts
│   └── infrastructure/                     # Production adapters
│       └── adapters/
│           ├── persistence/
│           │   └── dynamodb-job-repository.adapter.ts
│           ├── storage/
│           │   └── s3-file-storage.adapter.ts
│           └── messaging/
│               └── sqs-message-queue.adapter.ts
│
├── test/
│   ├── acceptance/                         # ATDD tests
│   │   ├── features/                       # Gherkin feature files
│   │   │   ├── start-export-job.feature
│   │   │   ├── complete-job.feature
│   │   │   ├── poll-export-status.feature
│   │   │   └── end-to-end-export-workflow.feature
│   │   ├── step-definitions/               # Step implementations
│   │   │   ├── start-export-job-steps.ts
│   │   │   ├── complete-job-steps.ts
│   │   │   ├── poll-export-status-steps.ts
│   │   │   └── end-to-end-steps.ts
│   │   └── support/                        # Test infrastructure
│   │       ├── world.ts                    # Test context
│   │       └── hooks.ts                    # Before/After hooks
│   └── in-memory-adapters/                 # Test doubles
│       ├── in-memory-job-repository.adapter.ts
│       ├── in-memory-export-api.adapter.ts
│       ├── in-memory-event-publisher.adapter.ts
│       ├── in-memory-step-functions.adapter.ts
│       ├── in-memory-file-storage.adapter.ts
│       └── in-memory-message-queue.adapter.ts
│
├── cucumber.config.js                      # Cucumber configuration
├── tsconfig.cucumber.json                  # TypeScript config for tests
└── ATDD-README.md                          # This file
```

---

## Writing Feature Files

### Gherkin Syntax

Feature files use **Gherkin** language with Given/When/Then steps:

```gherkin
Feature: Start Export Job

  As a system user
  I want to start an export job
  So that I can retrieve exported data from the external API

  Scenario: Export is immediately ready with download URLs
    Given the export service is initialized
    Given an export "export-123" for user "user-456" is already READY with download URLs
    When I start an export job with:
      | jobId    | job-001    |
      | exportId | export-123 |
      | userId   | user-456   |
    Then the job should be created successfully
    And the job status should be "DOWNLOADING"
    And the export should not need polling
    And a "job.created" event should be published
```

### Gherkin Keywords

- **Feature**: High-level description of functionality
- **Scenario**: Specific test case
- **Given**: Setup/preconditions
- **When**: Action being tested
- **Then**: Expected outcome
- **And**: Additional steps (same as previous keyword)
- **But**: Negative assertion

### Data Tables

**Inline table**:
```gherkin
When I start an export job with:
  | jobId    | job-001    |
  | exportId | export-123 |
  | userId   | user-456   |
```

**List table**:
```gherkin
Given an export "export-001" is already READY with download URLs:
  | https://api.example.com/files/file1.csv |
  | https://api.example.com/files/file2.csv |
```

**Multi-row table**:
```gherkin
When I complete the following tasks for job "job-001":
  | taskId   | success | errorMessage    |
  | task-001 | true    |                 |
  | task-002 | false   | Network timeout |
  | task-003 | true    |                 |
```

### Scenario Outlines

For testing multiple inputs:

```gherkin
Scenario Outline: Validate job status transitions
  Given a job exists with status "<current_status>"
  When I transition to "<new_status>"
  Then the transition should be "<result>"

  Examples:
    | current_status | new_status  | result  |
    | PENDING        | POLLING     | allowed |
    | POLLING        | DOWNLOADING | allowed |
    | DOWNLOADING    | COMPLETED   | allowed |
    | COMPLETED      | DOWNLOADING | denied  |
```

### Best Practices for Feature Files

1. **Business language**: Avoid technical implementation details
2. **Declarative**: Focus on *what* not *how*
3. **Single responsibility**: One scenario per behavior
4. **Independent scenarios**: Each scenario should be runnable in isolation
5. **Meaningful names**: Descriptive scenario titles

**Good**:
```gherkin
Scenario: Complete export workflow - with partial failures
  When I complete the following tasks for job "job-001":
    | taskId   | success | errorMessage |
    | task-001 | true    |              |
    | task-002 | false   | Timeout      |
  Then the job should be marked as complete
  And not all tasks should have succeeded
```

**Bad** (too technical):
```gherkin
Scenario: Test incrementCompletedTasks method
  When I call incrementCompletedTasks() on the entity
  Then the completedTasks property should increment by 1
```

---

## Implementing Step Definitions

### Basic Structure

**test/acceptance/step-definitions/start-export-job-steps.ts**:

```typescript
import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from 'chai';
import { ExportJobWorld } from '../support/world';
import { StartExportJobUseCase } from '../../../src/application/use-cases/start-export-job.use-case';
import { InMemoryJobRepositoryAdapter } from '../../in-memory-adapters/in-memory-job-repository.adapter';
import { InMemoryExportApiAdapter } from '../../in-memory-adapters/in-memory-export-api.adapter';
import { InMemoryEventPublisherAdapter } from '../../in-memory-adapters/in-memory-event-publisher.adapter';

// Module-level adapter instances (shared across steps in this file)
let jobRepository: InMemoryJobRepositoryAdapter;
let exportApi: InMemoryExportApiAdapter;
let eventPublisher: InMemoryEventPublisherAdapter;

// Given step - Setup
Given('the export service is initialized', function (this: ExportJobWorld) {
  // Create fresh adapters for each scenario
  jobRepository = new InMemoryJobRepositoryAdapter();
  exportApi = new InMemoryExportApiAdapter();
  eventPublisher = new InMemoryEventPublisherAdapter();

  // Store in World context for assertions
  this.context.jobRepository = jobRepository;
  this.context.exportApi = exportApi;
  this.context.eventPublisher = eventPublisher;

  this.context.testingModule = null; // Not using NestJS DI in tests
});

// When step - Action
When('I start an export job with:', async function (this: ExportJobWorld, dataTable: DataTable) {
  const data = dataTable.rowsHash(); // Convert table to object

  const command = {
    jobId: data.jobId,
    exportId: data.exportId,
    userId: data.userId,
    metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    taskToken: data.taskToken,
  };

  try {
    // Instantiate use case directly (no DI container)
    const useCase = new StartExportJobUseCase(
      jobRepository,
      exportApi,
      eventPublisher
    );

    this.context.lastResult = await useCase.execute(command);
    this.setJob(this.context.lastResult.job);
  } catch (error) {
    this.context.lastError = error as Error;
  }
});

// Then step - Assertion
Then('the job should be created successfully', function (this: ExportJobWorld) {
  expect(this.context.currentJob).to.not.be.undefined;
  expect(this.context.lastError).to.be.null;
});

Then('the job status should be {string}', function (this: ExportJobWorld, expectedStatus: string) {
  expect(this.context.currentJob).to.not.be.undefined;
  expect(this.context.currentJob!.jobState.status.value).to.equal(expectedStatus);
});
```

### Step Definition Patterns

#### 1. Simple String Parameter

```typescript
Given('a job {string} exists', async function (this: ExportJobWorld, jobId: string) {
  const job = ExportJobEntity.create({ jobId, /* ... */ });
  await jobRepository.save(job);
  this.setJob(job);
});
```

#### 2. Integer Parameter

```typescript
Given('a job {string} exists with {int} total tasks',
  async function (this: ExportJobWorld, jobId: string, totalTasks: number) {
    // totalTasks is automatically parsed as number
  }
);
```

#### 3. Data Table (Key-Value)

```typescript
When('I start an export job with:',
  async function (this: ExportJobWorld, dataTable: DataTable) {
    const data = dataTable.rowsHash(); // { jobId: '...', exportId: '...', ... }
    // Use data.jobId, data.exportId, etc.
  }
);
```

#### 4. Data Table (List)

```typescript
Given('an export {string} is already READY with download URLs:',
  function (this: ExportJobWorld, exportId: string, dataTable: DataTable) {
    const urls = dataTable.raw().flat(); // ['url1', 'url2', ...]
  }
);
```

#### 5. Data Table (Multi-Row)

```typescript
When('I complete the following tasks for job {string}:',
  async function (this: ExportJobWorld, jobId: string, dataTable: DataTable) {
    const tasks = dataTable.hashes();
    // [{ taskId: 'task-001', success: 'true', ... }, ...]

    for (const task of tasks) {
      await useCase.execute({
        taskId: task.taskId,
        success: task.success === 'true',
      });
    }
  }
);
```

### Chai Assertions

This project uses **Chai** (not Jest) for assertions:

```typescript
// Equality
expect(value).to.equal(expected);
expect(value).to.not.equal(unexpected);

// Truthiness
expect(value).to.be.true;
expect(value).to.be.false;
expect(value).to.be.null;
expect(value).to.not.be.undefined;

// Numbers
expect(count).to.be.greaterThan(0);
expect(count).to.be.lessThanOrEqual(10);

// Arrays/Strings
expect(array).to.include(item);
expect(array.length).to.equal(3);

// Objects
expect(obj).to.have.property('name');
expect(obj.name).to.equal('value');

// Instances
expect(date).to.be.instanceOf(Date);
```

### Handling Errors

```typescript
When('I perform an invalid action', async function (this: ExportJobWorld) {
  try {
    await useCase.execute(invalidCommand);
  } catch (error) {
    this.context.lastError = error as Error;
  }
});

Then('an error should be thrown with message {string}',
  function (this: ExportJobWorld, expectedMessage: string) {
    expect(this.context.lastError).to.not.be.null;
    expect(this.context.lastError!.message).to.include(expectedMessage);
  }
);
```

---

## In-Memory Adapters

### Purpose

In-memory adapters implement port interfaces using in-memory data structures instead of real infrastructure.

### Example: Job Repository Adapter

**test/in-memory-adapters/in-memory-job-repository.adapter.ts**:

```typescript
import { Injectable } from '@nestjs/common';
import { JobStateRepositoryPort } from '../../src/application/ports/output/job-state-repository.port';
import { ExportJobEntity } from '../../src/domain/entities/export-job.entity';
import { JobStateVO } from '../../src/domain/value-objects/job-state.vo';

@Injectable()
export class InMemoryJobRepositoryAdapter implements JobStateRepositoryPort {
  // In-memory storage
  private jobs: Map<string, ExportJobEntity> = new Map();

  async save(job: ExportJobEntity): Promise<void> {
    // Clone to ensure immutability
    this.jobs.set(job.jobId, this.cloneJob(job));
  }

  async findById(jobId: string): Promise<ExportJobEntity | null> {
    const job = this.jobs.get(jobId);
    return job ? this.cloneJob(job) : null;
  }

  async updateJobState(jobId: string, jobState: JobStateVO): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Entities are immutable - create new instance
    const updatedJob = job.withJobState(jobState);
    this.jobs.set(jobId, updatedJob);
  }

  async incrementCompletedTasks(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedJob = job.incrementCompletedTasks();
    this.jobs.set(jobId, updatedJob);
  }

  async incrementFailedTasks(jobId: string, errorMessage?: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedJob = job.incrementFailedTasks(errorMessage);
    this.jobs.set(jobId, updatedJob);
  }

  // Test helper methods

  /**
   * Get all jobs (for test assertions)
   */
  getAllJobs(): ExportJobEntity[] {
    return Array.from(this.jobs.values()).map(job => this.cloneJob(job));
  }

  /**
   * Clear all data (called between test scenarios)
   */
  clear(): void {
    this.jobs.clear();
  }

  /**
   * Clone job to ensure immutability
   */
  private cloneJob(job: ExportJobEntity): ExportJobEntity {
    return ExportJobEntity.create({
      jobId: job.jobId,
      exportId: job.exportId,
      userId: job.userId,
      jobState: job.jobState,
      metadata: job.metadata,
      maxPollingAttempts: job.maxPollingAttempts,
      pollingIntervalMs: job.pollingIntervalMs,
      downloadTasks: [...job.downloadTasks],
      taskToken: job.taskToken,
    });
  }
}
```

### Example: Event Publisher Adapter

**test/in-memory-adapters/in-memory-event-publisher.adapter.ts**:

```typescript
import { Injectable } from '@nestjs/common';
import { EventPublisherPort } from '../../src/application/ports/output/event-publisher.port';
import { DomainEvent } from '../../src/domain/events/base.event';

@Injectable()
export class InMemoryEventPublisherAdapter implements EventPublisherPort {
  private publishedEvents: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.publishedEvents.push(event);
  }

  async publishBatch(events: DomainEvent[]): Promise<void> {
    this.publishedEvents.push(...events);
  }

  publishAsync(event: DomainEvent): void {
    this.publishedEvents.push(event);
  }

  // Test helper methods

  getPublishedEvents(): DomainEvent[] {
    return [...this.publishedEvents];
  }

  getEventsByType<T extends DomainEvent>(eventName: string): T[] {
    return this.publishedEvents
      .filter(event => event.eventName === eventName) as T[];
  }

  getEventCount(): number {
    return this.publishedEvents.length;
  }

  getEventCountByType(eventName: string): number {
    return this.publishedEvents
      .filter(event => event.eventName === eventName).length;
  }

  hasEventType(eventName: string): boolean {
    return this.publishedEvents.some(event => event.eventName === eventName);
  }

  getLastEvent(): DomainEvent | null {
    return this.publishedEvents.length > 0
      ? this.publishedEvents[this.publishedEvents.length - 1]
      : null;
  }

  getLastEventOfType<T extends DomainEvent>(eventName: string): T | null {
    const events = this.getEventsByType<T>(eventName);
    return events.length > 0 ? events[events.length - 1] : null;
  }

  clear(): void {
    this.publishedEvents = [];
  }

  getEventsInOrder(): DomainEvent[] {
    return [...this.publishedEvents].sort((a, b) =>
      a.occurredAt.getTime() - b.occurredAt.getTime()
    );
  }

  findEvents(predicate: (event: DomainEvent) => boolean): DomainEvent[] {
    return this.publishedEvents.filter(predicate);
  }
}
```

### Key Principles for In-Memory Adapters

1. **Implement the port interface exactly**: Same method signatures
2. **Use in-memory data structures**: Maps, Arrays, Sets
3. **Maintain immutability**: Clone objects when storing/retrieving
4. **Add test helpers**: Methods to inspect state and clear data
5. **Simulate real behavior**: Match production adapter semantics
6. **Keep it simple**: No complex logic, just store and retrieve

---

## Test Context and World

### World Class

The **World** is the test context shared across all steps in a scenario.

**test/acceptance/support/world.ts**:

```typescript
import { World, setWorldConstructor } from '@cucumber/cucumber';
import { TestingModule } from '@nestjs/testing';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { DownloadTaskEntity } from '../../../src/domain/entities/download-task.entity';
import { DomainEvent } from '../../../src/domain/events/base.event';

export interface TestContext {
  // NestJS Testing Module (not used in pure ATDD)
  testingModule: TestingModule | null;

  // In-Memory Adapters (for direct access in assertions)
  jobRepository?: any;
  exportApi?: any;
  eventPublisher?: any;
  stepFunctions?: any;

  // Domain State
  currentJob: ExportJobEntity | null;
  currentTask: DownloadTaskEntity | null;
  jobs: Map<string, ExportJobEntity>;
  tasks: Map<string, DownloadTaskEntity>;

  // Result Tracking
  lastResult: any;
  lastError: Error | null;

  // Mock Data
  exportApiResponses: Map<string, any>;
  queuedMessages: Map<string, any[]>;
  publishedEvents: DomainEvent[];
}

export class ExportJobWorld extends World {
  public context: TestContext;

  constructor(options: any) {
    super(options);
    this.reset();
  }

  reset(): void {
    this.context = {
      testingModule: null,
      currentJob: null,
      currentTask: null,
      jobs: new Map(),
      tasks: new Map(),
      lastResult: null,
      lastError: null,
      exportApiResponses: new Map(),
      queuedMessages: new Map(),
      publishedEvents: [],
    };
  }

  // Helper methods

  setJob(job: ExportJobEntity): void {
    this.context.currentJob = job;
    this.context.jobs.set(job.jobId, job);
  }

  getJob(jobId: string): ExportJobEntity | undefined {
    return this.context.jobs.get(jobId);
  }

  setTask(task: DownloadTaskEntity): void {
    this.context.currentTask = task;
    this.context.tasks.set(task.taskId, task);
  }

  getTask(taskId: string): DownloadTaskEntity | undefined {
    return this.context.tasks.get(taskId);
  }

  addPublishedEvent(event: DomainEvent): void {
    this.context.publishedEvents.push(event);
  }

  getEventsByType<T extends DomainEvent>(eventName: string): T[] {
    return this.context.publishedEvents
      .filter(event => event.eventName === eventName) as T[];
  }

  addQueueMessage(queueUrl: string, message: any): void {
    if (!this.context.queuedMessages.has(queueUrl)) {
      this.context.queuedMessages.set(queueUrl, []);
    }
    this.context.queuedMessages.get(queueUrl)!.push(message);
  }

  getQueuedMessages(queueUrl: string): any[] {
    return this.context.queuedMessages.get(queueUrl) || [];
  }
}

setWorldConstructor(ExportJobWorld);
```

### Hooks

**test/acceptance/support/hooks.ts**:

```typescript
import { Before, After, AfterAll, BeforeAll, Status } from '@cucumber/cucumber';
import { ExportJobWorld } from './world';
import { clearEndToEndAdapters } from '../step-definitions/end-to-end-steps';
import { clearCompleteJobAdapters } from '../step-definitions/complete-job-steps';

BeforeAll(async function () {
  // Global setup - runs once before all scenarios
  console.log('Starting ATDD test suite...');
});

Before(async function (this: ExportJobWorld) {
  // Reset context before each scenario
  this.reset();

  // Clear all in-memory adapters to prevent state leakage between scenarios
  clearEndToEndAdapters();
  clearCompleteJobAdapters();
});

After(async function (this: ExportJobWorld, { result }) {
  // Cleanup after each scenario
  if (this.context.testingModule) {
    await this.context.testingModule.close();
    this.context.testingModule = null;
  }

  // Log failures for debugging
  if (result?.status === Status.FAILED) {
    console.error('Scenario failed:', result.message);
    if (this.context.lastError) {
      console.error('Last error:', this.context.lastError);
    }
  }
});

AfterAll(async function () {
  // Global teardown - runs once after all scenarios
  console.log('ATDD test suite completed.');
});
```

### Clearing Adapter State

Export clear functions from step definition files:

```typescript
// In step definition file
let jobRepository: InMemoryJobRepositoryAdapter;
let exportApi: InMemoryExportApiAdapter;
let eventPublisher: InMemoryEventPublisherAdapter;

export function clearAdapters() {
  if (jobRepository) jobRepository.clear();
  if (exportApi) exportApi.clear();
  if (eventPublisher) eventPublisher.clear();
}
```

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm run test:atdd

# Run specific feature file
npm run test:atdd -- test/acceptance/features/start-export-job.feature

# Run scenarios matching a pattern
npm run test:atdd -- --name "Export is immediately ready"

# Run with specific tag
npm run test:atdd -- --tags "@wip"

# Watch mode (reruns on file change)
npm run test:atdd:watch
```

### Tags

Add tags to feature files:

```gherkin
@critical @happy-path
Scenario: Export is immediately ready with download URLs
  Given the export service is initialized
  # ...
```

Run tagged scenarios:

```bash
# Run all @critical scenarios
npm run test:atdd -- --tags "@critical"

# Run @critical but not @slow
npm run test:atdd -- --tags "@critical and not @slow"
```

### Output Formats

```bash
# Progress bar (default)
npm run test:atdd

# Detailed output
npm run test:atdd -- --format progress

# JSON output
npm run test:atdd -- --format json:test/reports/cucumber-report.json

# Multiple formats
npm run test:atdd -- --format progress --format html:test/reports/report.html
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: ATDD Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:atdd
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v2
        with:
          name: cucumber-report
          path: test/reports/cucumber-report.html
```

---

## Best Practices

### 1. Scenario Independence

Each scenario should run in isolation:

```typescript
Before(async function (this: ExportJobWorld) {
  this.reset();              // Reset World context
  clearAllAdapters();        // Clear in-memory data
});
```

### 2. Direct Use Case Instantiation

Avoid NestJS DI in tests for simplicity:

```typescript
// ✅ Good: Direct instantiation
const useCase = new StartExportJobUseCase(
  jobRepository,
  exportApi,
  eventPublisher
);

// ❌ Bad: Complex test setup
const module = await Test.createTestingModule({ ... });
const useCase = module.get(StartExportJobPort);
```

### 3. Entity Immutability

Always capture returned instances:

```typescript
// ✅ Good: Capture returned instance
let job = this.context.currentJob!;
for (let i = 0; i < count; i++) {
  job = job.incrementCompletedTasks();  // Entities are immutable
}
await repo.save(job);

// ❌ Bad: Mutating in place (doesn't work)
for (let i = 0; i < count; i++) {
  this.context.currentJob!.incrementCompletedTasks();
}
```

### 4. Adapter State Management

Clear adapters between scenarios, not within scenarios:

```typescript
// ✅ Good: Clear in Before hook
Before(async function (this: ExportJobWorld) {
  clearAllAdapters();
});

// ❌ Bad: Clearing mid-scenario
Given('an export is ready', function () {
  exportApi.clear();  // Wipes out data from previous steps!
});
```

### 5. Use Factory Methods

Prefer factory methods over constructors:

```typescript
// ✅ Good: Factory method
const job = ExportJobEntity.create({ jobId, exportId, userId, ... });
const status = JobStatusVO.downloading();

// ❌ Bad: Direct constructor (often private)
const job = new ExportJobEntity(...);
const status = JobStatusVO.DOWNLOADING;  // Static constant
```

### 6. Meaningful Assertions

```typescript
// ✅ Good: Specific assertion with context
Then('the job should have 2 completed tasks', function (this: ExportJobWorld) {
  expect(this.context.currentJob).to.not.be.undefined;

  const actualCount = this.context.currentJob!.jobState.completedTasks;
  if (actualCount !== 2) {
    console.log(`[DEBUG] Expected 2 completed tasks but got ${actualCount}`);
    console.log(`[DEBUG] Job state:`, this.context.currentJob!.jobState);
  }

  expect(actualCount).to.equal(2);
});

// ❌ Bad: Generic assertion
Then('the job should be valid', function () {
  expect(this.context.currentJob).to.be.ok;
});
```

### 7. Share Adapters via Context

Store adapters in World context for cross-file access:

```typescript
Given('the export service is initialized', function (this: ExportJobWorld) {
  jobRepository = new InMemoryJobRepositoryAdapter();
  exportApi = new InMemoryExportApiAdapter();

  // Store in context
  this.context.jobRepository = jobRepository;
  this.context.exportApi = exportApi;
});

// Later, in different step file
When('I poll the export status', async function (this: ExportJobWorld) {
  // Use from context OR module-level variable
  const repo = this.context.jobRepository || jobRepository;
  const api = this.context.exportApi || exportApi;
});
```

### 8. Test Events

Verify domain events are published:

```typescript
Then('a {string} event should be published',
  function (this: ExportJobWorld, eventType: string) {
    const events = this.context.eventPublisher!.getEventsByType(eventType);
    expect(events.length).to.be.greaterThan(0);
  }
);

Then('exactly {int} {string} events should be published',
  function (this: ExportJobWorld, count: number, eventType: string) {
    const events = this.context.eventPublisher!.getEventsByType(eventType);
    expect(events.length).to.equal(count);
  }
);
```

---

## Troubleshooting

### Common Issues

#### 1. "Cannot find module" errors

**Problem**: TypeScript can't resolve imports

**Solution**: Check `tsconfig.cucumber.json` has correct paths:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": [
    "test/acceptance/**/*.ts",
    "test/in-memory-adapters/**/*.ts"
  ]
}
```

#### 2. "Property does not exist" on Chai assertions

**Problem**: Using Jest syntax instead of Chai

**Solution**: Convert assertions:

```typescript
// Jest → Chai
expect(value).toBe(expected)           → expect(value).to.equal(expected)
expect(value).toBeDefined()            → expect(value).to.not.be.undefined
expect(value).toBeNull()               → expect(value).to.be.null
expect(value).toBeGreaterThan(0)       → expect(value).to.be.greaterThan(0)
expect(array).toContain(item)          → expect(array).to.include(item)
```

#### 3. Steps not matched

**Problem**: Cucumber can't find step definition

**Solution**: Check Cucumber config has correct paths:

```javascript
require: [
  'test/acceptance/step-definitions/**/*.ts',  // All step files
  'test/acceptance/support/**/*.ts',            // World and hooks
],
```

#### 4. State leaking between scenarios

**Problem**: Previous scenario data appears in current scenario

**Solution**: Clear adapters in Before hook:

```typescript
Before(async function (this: ExportJobWorld) {
  this.reset();
  clearAllAdapters();
});
```

#### 5. Entities not updating

**Problem**: Entity changes don't persist

**Solution**: Capture returned immutable instances:

```typescript
// Correct
let job = this.context.currentJob!;
job = job.incrementCompletedTasks();
await repo.save(job);

// Wrong
this.context.currentJob!.incrementCompletedTasks();  // Returns new instance!
```

#### 6. Module format errors

**Problem**: "Cannot use import statement outside a module"

**Solution**: Ensure `tsconfig.cucumber.json` uses CommonJS:

```json
{
  "compilerOptions": {
    "module": "commonjs"  // Required for Cucumber
  }
}
```

---

## Advanced Patterns

### Parameterized Steps

Use Cucumber expressions for flexible matching:

```typescript
// Matches: "1 task", "2 tasks", "10 tasks"
Given('a job exists with {int} task(s)',
  async function (this: ExportJobWorld, totalTasks: number) {
    // ...
  }
);

// Matches: "should succeed", "should fail"
Then('the operation should {word}',
  function (this: ExportJobWorld, expectedResult: string) {
    if (expectedResult === 'succeed') {
      expect(this.context.lastError).to.be.null;
    } else {
      expect(this.context.lastError).to.not.be.null;
    }
  }
);
```

### Custom Parameter Types

Define custom types for domain objects:

```typescript
import { defineParameterType } from '@cucumber/cucumber';

defineParameterType({
  name: 'jobStatus',
  regexp: /PENDING|POLLING|DOWNLOADING|COMPLETED|FAILED/,
  transformer: (status: string) => JobStatusVO.fromString(status),
});

// Use in steps
Then('the job status should be {jobStatus}',
  function (this: ExportJobWorld, expectedStatus: JobStatusVO) {
    expect(this.context.currentJob!.jobState.status).to.equal(expectedStatus);
  }
);
```

### Async Step Definitions

Use async/await for asynchronous operations:

```typescript
When('I start an export job', async function (this: ExportJobWorld) {
  const result = await useCase.execute(command);
  this.context.lastResult = result;
});
```

### Scenario Hooks

Run hooks for specific scenarios only:

```typescript
import { Before } from '@cucumber/cucumber';

Before({ tags: '@database' }, async function () {
  // Only runs for scenarios tagged @database
  await setupDatabase();
});
```

### Background Steps

Reuse setup across multiple scenarios:

```gherkin
Feature: Export Job

  Background:
    Given the export service is initialized
    And an export "export-001" is already READY

  Scenario: Start job immediately
    When I start an export job
    Then the job should be downloading

  Scenario: Check job status
    When I start an export job
    And I check the job status
    Then the status should be "DOWNLOADING"
```

### Debugging

Add debug output to step definitions:

```typescript
When('I complete task {string}', async function (this: ExportJobWorld, taskId: string) {
  console.log(`[DEBUG] Before: completedTasks=${this.context.currentJob!.jobState.completedTasks}`);

  const result = await useCase.execute({ taskId });

  console.log(`[DEBUG] After: completedTasks=${result.job.jobState.completedTasks}`);
  console.log(`[DEBUG] Job state:`, result.job.jobState);
});
```

### Performance Testing

Measure execution time in scenarios:

```typescript
let startTime: number;

When('I start the export process', async function (this: ExportJobWorld) {
  startTime = Date.now();
  await useCase.execute(command);
});

Then('the process should complete in less than {int}ms',
  function (this: ExportJobWorld, maxDuration: number) {
    const duration = Date.now() - startTime;
    expect(duration).to.be.lessThan(maxDuration);
  }
);
```

---

## Summary

### Key Takeaways

1. **ATDD enables collaboration** between business and technical stakeholders
2. **Gherkin provides living documentation** that's always up to date
3. **In-memory adapters** make tests fast and reliable
4. **Hexagonal architecture** enables easy swapping of adapters
5. **TypeScript** provides type safety for step definitions
6. **Direct instantiation** keeps tests simple (no DI complexity)
7. **Immutability** requires capturing returned instances
8. **Clear adapter state** between scenarios to prevent leakage

### Next Steps

1. Write feature files for your business scenarios
2. Implement step definitions incrementally
3. Create in-memory adapters for your ports
4. Run tests frequently during development
5. Refactor production code based on test feedback
6. Use tests as documentation for new team members

### Resources

- [Cucumber Documentation](https://cucumber.io/docs/cucumber/)
- [Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)
- [Chai Assertion Library](https://www.chaijs.com/)
- [Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)

---

**Happy Testing! 🥒**
