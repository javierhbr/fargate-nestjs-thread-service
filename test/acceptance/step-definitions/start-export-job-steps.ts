import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from 'chai';
import { ExportJobWorld } from '../support/world';
import { StartExportJobUseCase } from '../../../src/application/use-cases/start-export-job.use-case';
import { InMemoryJobRepositoryAdapter } from '../../in-memory-adapters/in-memory-job-repository.adapter';
import { InMemoryExportApiAdapter } from '../../in-memory-adapters/in-memory-export-api.adapter';
import { InMemoryEventPublisherAdapter } from '../../in-memory-adapters/in-memory-event-publisher.adapter';
import { ExportStatusVO } from '../../../src/domain/value-objects/export-status.vo';

// Shared adapter instances for step definitions
let jobRepository: InMemoryJobRepositoryAdapter;
let exportApi: InMemoryExportApiAdapter;
let eventPublisher: InMemoryEventPublisherAdapter;

Given('the export service is initialized', function (this: ExportJobWorld) {
  // Initialize in-memory adapters
  jobRepository = new InMemoryJobRepositoryAdapter();
  exportApi = new InMemoryExportApiAdapter();
  eventPublisher = new InMemoryEventPublisherAdapter();

  // Store adapters in context for test access (especially event publisher for assertions)
  this.context.exportApi = exportApi;
  this.context.jobRepository = jobRepository;
  this.context.eventPublisher = eventPublisher;

  // No need for NestJS DI in tests - just instantiate directly
  this.context.testingModule = null; // Not using NestJS module for ATDD
});

Given(
  'an export {string} for user {string} is already READY with download URLs',
  function (this: ExportJobWorld, exportId: string, userId: string) {
    const downloadUrls = [
      `https://example.com/files/${exportId}/file1.csv`,
      `https://example.com/files/${exportId}/file2.csv`,
    ];

    exportApi.createMockExport(exportId, userId, ExportStatusVO.ready(), downloadUrls);
  },
);

Given(
  'an export {string} for user {string} is in PROCESSING state',
  function (this: ExportJobWorld, exportId: string, userId: string) {
    exportApi.createMockExport(exportId, userId, ExportStatusVO.processing());
  },
);

Given(
  'the export will become READY after {int} polls',
  function (this: ExportJobWorld, _pollCount: number) {
    // This will be configured when we know the exportId from the previous step
    // We'll configure it in the When step
    this.context.exportApiResponses.set('pollsToReady', {
      status: 'PROCESSING',
      downloadUrls: ['https://example.com/file1.csv'],
    } as any);
  },
);

Given(
  'an export {string} for user {string} has FAILED with error {string}',
  function (
    this: ExportJobWorld,
    exportId: string,
    userId: string,
    errorMessage: string,
  ) {
    exportApi.createMockExport(
      exportId,
      userId,
      ExportStatusVO.failed(),
      undefined,
      errorMessage,
    );
  },
);

Given(
  'an export {string} for user {string} has EXPIRED',
  function (this: ExportJobWorld, exportId: string, userId: string) {
    exportApi.createMockExport(exportId, userId, ExportStatusVO.expired());
  },
);

When(
  'I start an export job with:',
  async function (this: ExportJobWorld, dataTable: DataTable) {
    const data = dataTable.rowsHash();

    const command = {
      jobId: data.jobId,
      exportId: data.exportId,
      userId: data.userId,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
      taskToken: data.taskToken,
    };

    try {
      // Use adapters from context if available (for cross-file scenarios), otherwise use module-level
      const repo = this.context.jobRepository || jobRepository;
      const api = this.context.exportApi || exportApi;
      const publisher = this.context.eventPublisher || eventPublisher;

      // Instantiate use case directly with in-memory adapters
      const useCase = new StartExportJobUseCase(repo, api, publisher);
      this.context.lastResult = await useCase.execute(command);
      this.setJob(this.context.lastResult.job);
    } catch (error) {
      this.context.lastError = error as Error;
    }
  },
);

Then('the job should be created successfully', function (this: ExportJobWorld) {
  expect(this.context.lastError).to.be.null;
  expect(this.context.lastResult).to.not.be.undefined;
  expect(this.context.currentJob).to.not.be.undefined;
});

Then(
  'the job status should be {string}',
  function (this: ExportJobWorld, expectedStatus: string) {
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.jobState.status.value).to.equal(expectedStatus);
  },
);

Then('the export should not need polling', function (this: ExportJobWorld) {
  expect(this.context.lastResult.needsPolling).to.equal(false);
});

Then('the system should be ready to start downloading', function (this: ExportJobWorld) {
  expect(this.context.lastResult.canStartDownloading).to.equal(true);
});

Then('the export should need polling', function (this: ExportJobWorld) {
  expect(this.context.lastResult.needsPolling).to.equal(true);
});

Then(
  'the system should not be ready to start downloading yet',
  function (this: ExportJobWorld) {
    expect(this.context.lastResult.canStartDownloading).to.equal(false);
  },
);

Then(
  'a {string} event should be published',
  function (this: ExportJobWorld, eventType: string) {
    const publisher = this.context.eventPublisher!;
    const events = publisher.getEventsByType(eventType);
    const allEvents = publisher.getPublishedEvents();

    // Debug: log event information if assertion fails
    if (events.length === 0) {
      console.log(`[DEBUG] No ${eventType} events found`);
      console.log(`[DEBUG] Total events published: ${allEvents.length}`);
      console.log(
        `[DEBUG] Event types:`,
        allEvents.map((e: any) => e.eventName),
      );
    }

    expect(events.length).to.be.greaterThan(0);
  },
);

Then(
  'the job should have error message {string}',
  function (this: ExportJobWorld, expectedError: string) {
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.jobState.errorMessage).to.equal(expectedError);
  },
);

Then(
  'the job should have error message containing {string}',
  function (this: ExportJobWorld, expectedErrorPart: string) {
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.jobState.errorMessage).to.include(expectedErrorPart);
  },
);

Then(
  'the job should have metadata:',
  function (this: ExportJobWorld, dataTable: DataTable) {
    const expectedMetadata = dataTable.rowsHash();
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.metadata).to.not.be.undefined;

    for (const [key, value] of Object.entries(expectedMetadata)) {
      expect(this.context.currentJob!.metadata![key]).to.equal(value);
    }
  },
);

Then(
  'the job should have task token {string}',
  function (this: ExportJobWorld, expectedToken: string) {
    expect(this.context.currentJob).to.not.be.undefined;
    expect(this.context.currentJob!.taskToken).to.equal(expectedToken);
  },
);
