import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { DynamoDbService } from '../../shared/aws/dynamodb/dynamodb.service';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';
import { ExportJobStatus } from '../../shared/interfaces/export-job.interface';
import { ExportApiService } from './export-api.service';
import { TaskDispatcherService } from './task-dispatcher.service';
import { ExportApiStatus } from '../interfaces/export-api-response.interface';

interface ActivePollingJob {
  jobId: string;
  exportId: string;
  userId: string;
  startedAt: Date;
  attempts: number;
  lastPollAt?: Date;
}

@Injectable()
export class PollingService {
  private readonly pollingIntervalMs: number;
  private readonly maxPollingAttempts: number;
  private activePollingJobs: Map<string, ActivePollingJob> = new Map();
  private pollingTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly exportApi: ExportApiService,
    private readonly taskDispatcher: TaskDispatcherService,
    private readonly dynamoDb: DynamoDbService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const orchestratorConfig = this.configService.get('orchestrator', { infer: true })!;

    this.pollingIntervalMs = orchestratorConfig.pollingIntervalMs;
    this.maxPollingAttempts = orchestratorConfig.maxPollingAttempts;

    this.logger.setContext(PollingService.name);
  }

  startPolling(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.logger.info('Starting polling service');
    this.scheduleNextPoll();
  }

  stopPolling(): void {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.logger.info('Polling service stopped');
  }

  async addJobToPolling(jobId: string, exportId: string, userId: string): Promise<void> {
    if (this.activePollingJobs.has(jobId)) {
      this.logger.warn({ jobId }, 'Job already being polled');
      return;
    }

    const pollingJob: ActivePollingJob = {
      jobId,
      exportId,
      userId,
      startedAt: new Date(),
      attempts: 0,
    };

    this.activePollingJobs.set(jobId, pollingJob);

    await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.POLLING);

    this.logger.info({ jobId, exportId }, 'Job added to polling');

    // Start polling if not already running
    if (!this.isRunning) {
      this.startPolling();
    }
  }

  removeJobFromPolling(jobId: string): void {
    this.activePollingJobs.delete(jobId);
    this.logger.debug({ jobId }, 'Job removed from polling');
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.pollingTimer = setTimeout(async () => {
      await this.pollAllJobs();
      this.scheduleNextPoll();
    }, this.pollingIntervalMs);
  }

  private async pollAllJobs(): Promise<void> {
    if (this.activePollingJobs.size === 0) return;

    this.logger.debug({ activeJobs: this.activePollingJobs.size }, 'Polling active jobs');

    const jobs = Array.from(this.activePollingJobs.values());

    await Promise.all(jobs.map((job) => this.pollSingleJob(job)));
  }

  private async pollSingleJob(job: ActivePollingJob): Promise<void> {
    const { jobId, exportId } = job;

    try {
      job.attempts++;
      job.lastPollAt = new Date();

      // Check if max attempts exceeded
      if (job.attempts > this.maxPollingAttempts) {
        this.logger.error(
          { jobId, exportId, attempts: job.attempts },
          'Max polling attempts exceeded',
        );

        await this.handlePollingTimeout(job);
        return;
      }

      // Poll export API
      const exportStatus = await this.exportApi.getExportStatus(exportId);

      this.logger.debug(
        { jobId, exportId, status: exportStatus.status, attempt: job.attempts },
        'Poll result',
      );

      // Handle based on status
      switch (exportStatus.status) {
        case ExportApiStatus.READY:
          await this.handleExportReady(job, exportStatus.downloadUrls || []);
          break;

        case ExportApiStatus.FAILED:
          await this.handleExportFailed(job, exportStatus.error?.message);
          break;

        case ExportApiStatus.EXPIRED:
          await this.handleExportExpired(job);
          break;

        case ExportApiStatus.PENDING:
        case ExportApiStatus.PROCESSING:
          // Continue polling
          break;
      }
    } catch (error) {
      this.logger.error(
        { jobId, exportId, error: (error as Error).message },
        'Error polling job',
      );

      // Don't remove from polling on transient errors
      // Let it retry on next poll interval
    }
  }

  private async handleExportReady(
    job: ActivePollingJob,
    downloadUrls: {
      url: string;
      fileName: string;
      fileSize?: number;
      checksum?: string;
    }[],
  ): Promise<void> {
    const { jobId, exportId } = job;

    this.logger.info(
      { jobId, exportId, urlCount: downloadUrls.length },
      'Export ready, dispatching download tasks',
    );

    this.removeJobFromPolling(jobId);

    await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.DOWNLOADING);

    // Dispatch download tasks
    await this.taskDispatcher.dispatchDownloadTasks(jobId, exportId, downloadUrls);
  }

  private async handleExportFailed(
    job: ActivePollingJob,
    errorMessage?: string,
  ): Promise<void> {
    const { jobId, exportId } = job;

    this.logger.error({ jobId, exportId, error: errorMessage }, 'Export failed');

    this.removeJobFromPolling(jobId);

    await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
      error: {
        code: 'EXPORT_API_FAILED',
        message: errorMessage || 'Export failed',
      },
    });
  }

  private async handleExportExpired(job: ActivePollingJob): Promise<void> {
    const { jobId, exportId } = job;

    this.logger.error({ jobId, exportId }, 'Export expired');

    this.removeJobFromPolling(jobId);

    await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
      error: {
        code: 'EXPORT_EXPIRED',
        message: 'Export expired before download',
      },
    });
  }

  private async handlePollingTimeout(job: ActivePollingJob): Promise<void> {
    const { jobId } = job;

    this.removeJobFromPolling(jobId);

    await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
      error: {
        code: 'POLLING_TIMEOUT',
        message: `Export did not complete after ${this.maxPollingAttempts} attempts`,
      },
    });
  }

  getActiveJobCount(): number {
    return this.activePollingJobs.size;
  }

  getActiveJobs(): ActivePollingJob[] {
    return Array.from(this.activePollingJobs.values());
  }
}
