import { World, IWorldOptions, setWorldConstructor } from '@cucumber/cucumber';
import { Test, TestingModule } from '@nestjs/testing';
import { ExportJobEntity } from '../../../src/domain/entities/export-job.entity';
import { DownloadTaskEntity } from '../../../src/domain/entities/download-task.entity';
import { DomainEvent } from '../../../src/domain/events/base.event';

export interface TestContext {
  // NestJS Testing Module
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
  publishedEvents: DomainEvent[];

  // Export API Simulation State
  exportApiResponses: Map<string, {
    status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
    downloadUrls?: string[];
    errorMessage?: string;
  }>;

  // File Storage Simulation State
  storedFiles: Map<string, Buffer>;
  fileMetadata: Map<string, {
    size: number;
    checksum?: string;
    contentType?: string;
  }>;

  // Message Queue Simulation State
  queuedMessages: Map<string, any[]>;

  // Worker Pool Simulation State
  workerPoolTasks: any[];
  workerPoolCapacity: number;

  // Step Functions Simulation State
  stepFunctionsCallbacks: Array<{
    type: 'success' | 'failure';
    taskToken: string;
    output?: any;
    error?: string;
  }>;
}

export class ExportJobWorld extends World {
  public context: TestContext;

  constructor(options: IWorldOptions) {
    super(options);

    this.context = {
      testingModule: null,
      currentJob: null,
      currentTask: null,
      jobs: new Map(),
      tasks: new Map(),
      lastResult: null,
      lastError: null,
      publishedEvents: [],
      exportApiResponses: new Map(),
      storedFiles: new Map(),
      fileMetadata: new Map(),
      queuedMessages: new Map(),
      workerPoolTasks: [],
      workerPoolCapacity: 10,
      stepFunctionsCallbacks: [],
    };
  }

  // Helper methods for test context management
  reset(): void {
    this.context.currentJob = null;
    this.context.currentTask = null;
    this.context.jobs.clear();
    this.context.tasks.clear();
    this.context.lastResult = null;
    this.context.lastError = null;
    this.context.publishedEvents = [];
    this.context.exportApiResponses.clear();
    this.context.storedFiles.clear();
    this.context.fileMetadata.clear();
    this.context.queuedMessages.clear();
    this.context.workerPoolTasks = [];
    this.context.stepFunctionsCallbacks = [];
  }

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

  addEvent(event: DomainEvent): void {
    this.context.publishedEvents.push(event);
  }

  getEventsByType<T extends DomainEvent>(eventName: string): T[] {
    return this.context.publishedEvents
      .filter(event => event.eventName === eventName) as T[];
  }

  setExportApiResponse(exportId: string, response: {
    status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
    downloadUrls?: string[];
    errorMessage?: string;
  }): void {
    this.context.exportApiResponses.set(exportId, response);
  }

  storeFile(key: string, content: Buffer, metadata?: {
    size: number;
    checksum?: string;
    contentType?: string;
  }): void {
    this.context.storedFiles.set(key, content);
    if (metadata) {
      this.context.fileMetadata.set(key, metadata);
    }
  }

  getFile(key: string): Buffer | undefined {
    return this.context.storedFiles.get(key);
  }

  queueMessage(queueUrl: string, message: any): void {
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
