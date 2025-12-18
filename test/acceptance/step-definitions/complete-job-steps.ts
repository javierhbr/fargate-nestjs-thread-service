import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { Test } from '@nestjs/testing';
import { expect } from 'chai';
import { ExportJobWorld } from '../support/world';
import { CompleteJobPort } from '../../../src/application/ports/input/complete-job.port';
import { CompleteJobUseCase } from '../../../src/application/use-cases/complete-job.use-case';
import { InMemoryJobRepositoryAdapter } from '../../in-memory-adapters/in-memory-job-repository.adapter';
import { InMemoryEventPublisherAdapter } from '../../in-memory-adapters/in-memory-event-publisher.adapter';
import { InMemoryStepFunctionsAdapter } from '../../in-memory-adapters/in-memory-step-functions.adapter';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { JobStateVO } from '../../../src/domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../../src/domain/value-objects/job-status.vo';

// Shared adapter instances
let jobRepository: InMemoryJobRepositoryAdapter;
let eventPublisher: InMemoryEventPublisherAdapter;
let stepFunctions: InMemoryStepFunctionsAdapter;

// Re-initialize adapters if not already initialized
function ensureAdaptersInitialized(world?: ExportJobWorld) {
  if (!jobRepository) {
    jobRepository = new InMemoryJobRepositoryAdapter();
    eventPublisher = new InMemoryEventPublisherAdapter();
    stepFunctions = new InMemoryStepFunctionsAdapter();
  }
  // Store in context for test access
  if (world) {
    world.context.jobRepository = jobRepository;
    world.context.eventPublisher = eventPublisher;
    world.context.stepFunctions = stepFunctions;
  }
}

// Export clear function for hooks to reset state between scenarios
export function clearCompleteJobAdapters() {
  if (jobRepository) jobRepository.clear();
  if (eventPublisher) eventPublisher.clear();
  if (stepFunctions) stepFunctions.clear();
}

Given(
  'a job {string} exists with {int} total tasks',
  async function (this: ExportJobWorld, jobId: string, totalTasks: number) {
    ensureAdaptersInitialized(this);

    // Not using NestJS module for ATDD
    this.context.testingModule = null;

    // Create a job entity
    const job = ExportJobEntity.create({
      jobId,
      exportId: `export-${jobId}`,
      userId: 'user-123',
      jobState: JobStateVO.create({
        status: JobStatusVO.downloading(),
        totalTasks,
        completedTasks: 0,
        failedTasks: 0,
      }),
      metadata: {},
    });

    // Use context repository if available
    const repo = this.context.jobRepository || jobRepository;
    await repo.save(job);
    this.setJob(job);
  },
);

Given(
  'the job has {int} completed task(s) and {int} failed task(s)',
  async function (this: ExportJobWorld, completedTasks: number, failedTasks: number) {
    let job = this.context.currentJob!;

    // Update the job state (capturing returned immutable instances)
    for (let i = 0; i < completedTasks; i++) {
      job = job.incrementCompletedTasks();
    }

    for (let i = 0; i < failedTasks; i++) {
      job = job.incrementFailedTasks();
    }

    // Use context repository if available
    const repo = this.context.jobRepository || jobRepository;
    await repo.save(job);
    this.setJob(job);
  },
);

Given(
  'the job has a task token {string}',
  async function (this: ExportJobWorld, taskToken: string) {
    // Need to recreate the job with taskToken since it's readonly
    const currentJob = this.context.currentJob!;
    const jobWithToken = ExportJobEntity.create({
      jobId: currentJob.jobId,
      exportId: currentJob.exportId,
      userId: currentJob.userId,
      jobState: currentJob.jobState,
      metadata: currentJob.metadata,
      taskToken,
    });

    // Use context repository if available
    const repo = this.context.jobRepository || jobRepository;
    await repo.save(jobWithToken);
    this.setJob(jobWithToken);
  },
);

When(
  'I complete task {string} for job {string} with success',
  async function (this: ExportJobWorld, taskId: string, jobId: string) {
    try {
      // Use adapters from context if available (for cross-file scenarios), otherwise use module-level
      const repo = this.context.jobRepository || jobRepository;
      const publisher = this.context.eventPublisher || eventPublisher;
      const sf = this.context.stepFunctions || stepFunctions;

      const useCase = new CompleteJobUseCase(repo, publisher, sf);
      this.context.lastResult = await useCase.execute({
        jobId,
        taskId,
        success: true,
      });
      this.setJob(this.context.lastResult.job);
    } catch (error) {
      this.context.lastError = error as Error;
    }
  },
);

When(
  'I complete task {string} for job {string} with failure and error {string}',
  async function (
    this: ExportJobWorld,
    taskId: string,
    jobId: string,
    errorMessage: string,
  ) {
    try {
      // Use adapters from context if available (for cross-file scenarios), otherwise use module-level
      const repo = this.context.jobRepository || jobRepository;
      const publisher = this.context.eventPublisher || eventPublisher;
      const sf = this.context.stepFunctions || stepFunctions;

      const useCase = new CompleteJobUseCase(repo, publisher, sf);
      this.context.lastResult = await useCase.execute({
        jobId,
        taskId,
        success: false,
        errorMessage,
      });
      this.setJob(this.context.lastResult.job);
    } catch (error) {
      this.context.lastError = error as Error;
    }
  },
);

When(
  'I complete the following tasks for job {string}:',
  async function (this: ExportJobWorld, jobId: string, dataTable: DataTable) {
    const tasks = dataTable.hashes();

    // Use adapters from context if available (for cross-file scenarios), otherwise use module-level
    const repo = this.context.jobRepository || jobRepository;
    const publisher = this.context.eventPublisher || eventPublisher;
    const sf = this.context.stepFunctions || stepFunctions;

    const useCase = new CompleteJobUseCase(repo, publisher, sf);

    for (const task of tasks) {
      const result = await useCase.execute({
        jobId,
        taskId: task.taskId,
        success: task.success === 'true',
        errorMessage: task.errorMessage || undefined,
      });

      this.context.lastResult = result;
      this.setJob(result.job);
    }
  },
);

Then(
  'the job should have {int} completed task(s)',
  function (this: ExportJobWorld, expectedCount: number) {
    expect(this.context.currentJob).to.not.be.undefined;

    const actualCount = this.context.currentJob!.jobState.completedTasks;
    if (actualCount !== expectedCount) {
      console.log(
        `[DEBUG] Expected ${expectedCount} completed tasks but got ${actualCount}`,
      );
      console.log(`[DEBUG] Job state:`, {
        totalTasks: this.context.currentJob!.jobState.totalTasks,
        completedTasks: actualCount,
        failedTasks: this.context.currentJob!.jobState.failedTasks,
      });
    }

    expect(actualCount).to.equal(expectedCount);
  },
);

Then(
  'the job should have {int} failed task(s)',
  function (this: ExportJobWorld, expectedCount: number) {
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.jobState.failedTasks).to.equal(expectedCount);
  },
);

Then('the job should not be marked as complete', function (this: ExportJobWorld) {
  expect(this.context.lastResult.isJobComplete).to.equal(false);
});

Then('the job should be marked as complete', function (this: ExportJobWorld) {
  expect(this.context.lastResult.isJobComplete).to.equal(true);
});

Then('all tasks should have succeeded', function (this: ExportJobWorld) {
  expect(this.context.lastResult.allTasksSucceeded).to.equal(true);
});

Then('not all tasks should have succeeded', function (this: ExportJobWorld) {
  expect(this.context.lastResult.allTasksSucceeded).to.equal(false);
});

Then('a Step Functions success callback should be sent', function (this: ExportJobWorld) {
  const successCallbacks = (
    this.context.stepFunctions || stepFunctions
  ).getSuccessCallbacks();
  expect(successCallbacks.length).to.be.greaterThan(0);
});

Then(
  'the success callback should include the job completion details',
  function (this: ExportJobWorld) {
    const taskToken = this.context.currentJob!.taskToken!;
    const sf = this.context.stepFunctions || stepFunctions;
    const output = sf.getSuccessOutput(taskToken);

    expect(output).to.not.be.undefined;
    expect(output!.jobId).to.equal(this.context.currentJob!.jobId);
    expect(output!.status).to.equal('COMPLETED');
    expect(output!.totalTasks).to.equal(this.context.currentJob!.jobState.totalTasks);
    expect(output!.completedTasks).to.equal(
      this.context.currentJob!.jobState.completedTasks,
    );
    expect(output!.failedTasks).to.equal(this.context.currentJob!.jobState.failedTasks);
  },
);

Then(
  'the success callback should indicate partial success',
  function (this: ExportJobWorld) {
    const taskToken = this.context.currentJob!.taskToken!;
    const sf = this.context.stepFunctions || stepFunctions;
    const output = sf.getSuccessOutput(taskToken);

    expect(output).to.not.be.undefined;
    expect(output!.failedTasks).to.be.greaterThan(0);
  },
);
