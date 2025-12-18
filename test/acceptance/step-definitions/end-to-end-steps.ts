import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from 'chai';
import { ExportJobWorld } from '../support/world';
import { PollExportStatusUseCase } from '../../../src/application/use-cases/poll-export-status.use-case';
import { InMemoryJobRepositoryAdapter } from '../../in-memory-adapters/in-memory-job-repository.adapter';
import { InMemoryExportApiAdapter } from '../../in-memory-adapters/in-memory-export-api.adapter';
import { InMemoryEventPublisherAdapter } from '../../in-memory-adapters/in-memory-event-publisher.adapter';
import { ExportStatusVO } from '../../../src/domain/value-objects/export-status.vo';

// Shared adapters (reuse from other step files if already initialized)
let jobRepository: InMemoryJobRepositoryAdapter;
let exportApi: InMemoryExportApiAdapter;
let eventPublisher: InMemoryEventPublisherAdapter;

function ensureAdaptersInitialized(world?: ExportJobWorld) {
  if (!jobRepository) {
    jobRepository = new InMemoryJobRepositoryAdapter();
    exportApi = new InMemoryExportApiAdapter();
    eventPublisher = new InMemoryEventPublisherAdapter();
  }
  // Store in context for test access
  if (world) {
    world.context.jobRepository = jobRepository;
    world.context.exportApi = exportApi;
    world.context.eventPublisher = eventPublisher;
  }
}

// Export clear function for hooks to reset state between scenarios
export function clearEndToEndAdapters() {
  if (jobRepository) jobRepository.clear();
  if (exportApi) exportApi.clear();
  if (eventPublisher) eventPublisher.clear();
}

Given(
  'an export {string} for user {string} is already READY with download URLs:',
  function (
    this: ExportJobWorld,
    exportId: string,
    userId: string,
    dataTable: DataTable,
  ) {
    ensureAdaptersInitialized(this);

    const downloadUrls = dataTable.raw().flat();
    exportApi.createMockExport(exportId, userId, ExportStatusVO.ready(), downloadUrls);

    // Store in context for validation
    this.context.exportApiResponses.set(exportId, {
      status: 'READY',
      downloadUrls,
    });
  },
);

Given('the file storage is configured', function (this: ExportJobWorld) {
  // File storage is already available via in-memory adapter
  // This is a declarative step for readability
});

Given('the message queue is ready', function (this: ExportJobWorld) {
  // Message queue is already available via in-memory adapter
  // This is a declarative step for readability
});

Given(
  'an export {string} for user {string} will transition to READY after polling',
  function (this: ExportJobWorld, exportId: string, userId: string) {
    ensureAdaptersInitialized(this);

    const downloadUrls = [
      `https://api.example.com/files/${exportId}/file1.csv`,
      `https://api.example.com/files/${exportId}/file2.csv`,
    ];

    // Configure export to transition after 2 polls
    exportApi.createMockExport(exportId, userId, ExportStatusVO.processing());
    exportApi.configureExportToTransition(exportId, 2, downloadUrls);
  },
);

Given(
  'an export {string} for user {string} will fail during polling with error {string}',
  function (
    this: ExportJobWorld,
    exportId: string,
    userId: string,
    errorMessage: string,
  ) {
    ensureAdaptersInitialized(this);

    // Configure export to fail after 2 polls
    exportApi.createMockExport(exportId, userId, ExportStatusVO.processing());
    exportApi.configureExportToFail(exportId, 2, errorMessage);
  },
);

When(
  'I poll the export status for job {string}',
  async function (this: ExportJobWorld, jobId: string) {
    ensureAdaptersInitialized(this);

    // Not using NestJS module for ATDD
    this.context.testingModule = null;

    try {
      // Use adapters from context if available (for cross-file scenarios), otherwise use module-level
      const repo = this.context.jobRepository || jobRepository;
      const api = this.context.exportApi || exportApi;
      const publisher = this.context.eventPublisher || eventPublisher;

      const useCase = new PollExportStatusUseCase(repo, api, publisher);
      this.context.lastResult = await useCase.execute({ jobId });
      this.setJob(this.context.lastResult.job);
    } catch (error) {
      this.context.lastError = error as Error;
    }
  },
);

Then('download URLs should be available', function (this: ExportJobWorld) {
  expect(this.context.lastResult.downloadUrls).to.not.be.undefined;
  expect(this.context.lastResult.downloadUrls.length).to.be.greaterThan(0);
});

Then('the job should have total tasks set', function (this: ExportJobWorld) {
  expect(this.context.currentJob).to.not.be.undefined;
  expect(this.context.currentJob!.jobState.totalTasks).to.be.greaterThan(0);
});

Then(
  'exactly {int} {string} events should be published',
  function (this: ExportJobWorld, count: number, eventType: string) {
    const events = this.context.eventPublisher!.getEventsByType(eventType);
    expect(events.length).to.equal(count);
  },
);

Then(
  'the job should have valid state:',
  function (this: ExportJobWorld, dataTable: DataTable) {
    const expectedState = dataTable.rowsHash();
    const job = this.context.currentJob!;

    expect(job.jobState.totalTasks).to.equal(Number(expectedState.totalTasks));
    expect(job.jobState.completedTasks).to.equal(Number(expectedState.completedTasks));
    expect(job.jobState.failedTasks).to.equal(Number(expectedState.failedTasks));
  },
);

Then('the job state invariants should be valid', function (this: ExportJobWorld) {
  const job = this.context.currentJob!;
  const { totalTasks, completedTasks, failedTasks } = job.jobState;

  // Verify invariant: completedTasks + failedTasks <= totalTasks
  expect(completedTasks + failedTasks).to.be.lessThanOrEqual(totalTasks);

  // Verify non-negative values
  expect(totalTasks).to.be.greaterThanOrEqual(0);
  expect(completedTasks).to.be.greaterThanOrEqual(0);
  expect(failedTasks).to.be.greaterThanOrEqual(0);

  // Verify timestamps
  expect(job.jobState.createdAt).to.be.instanceOf(Date);
  expect(job.jobState.updatedAt).to.be.instanceOf(Date);
  expect(job.jobState.updatedAt.getTime()).to.be.greaterThanOrEqual(
    job.jobState.createdAt.getTime(),
  );
});
