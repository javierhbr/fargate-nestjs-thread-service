import { Injectable, Logger } from '@nestjs/common';
import {
  PollExportStatusCommand,
  PollExportStatusPort,
  PollExportStatusResult,
} from '../ports/input/poll-export-status.port';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { ExportApiPort } from '../ports/output/export-api.port';
import { EventPublisherPort } from '../ports/output/event-publisher.port';
import { JobStatusVO } from '../../domain/value-objects/job-status.vo';
import { JobFailedEvent } from '../../domain/events/job-failed.event';

/**
 * Poll Export Status Use Case
 * Handles checking the external export API for status updates
 */
@Injectable()
export class PollExportStatusUseCase implements PollExportStatusPort {
  private readonly logger = new Logger(PollExportStatusUseCase.name);

  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly exportApi: ExportApiPort,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: PollExportStatusCommand): Promise<PollExportStatusResult> {
    this.logger.debug(`Polling export status for job: ${command.jobId}`);

    try {
      // Retrieve job from repository
      const job = await this.jobRepository.findById(command.jobId);
      if (!job) {
        throw new Error(`Job ${command.jobId} not found`);
      }

      // Check if job is in a state that can be polled
      if (job.status.isTerminal()) {
        this.logger.warn(`Job ${command.jobId} is in terminal state ${job.status.toString()}, skipping poll`);
        return {
          job,
          isReady: false,
          isFailed: job.status.isFailed(),
          shouldContinuePolling: false,
        };
      }

      // Get export status from external API
      const exportStatus = await this.exportApi.getExportStatus(job.exportId);

      this.logger.debug(`Export ${job.exportId} status: ${exportStatus.status.toString()}`);

      // Handle different status scenarios
      if (exportStatus.status.isReady()) {
        // Export is ready, transition job to downloading
        const updatedJob = job.transitionToDownloading();
        await this.jobRepository.updateJobState(command.jobId, updatedJob.jobState);

        return {
          job: updatedJob,
          isReady: true,
          isFailed: false,
          shouldContinuePolling: false,
          downloadUrls: exportStatus.downloadUrls,
        };
      } else if (exportStatus.status.isFailed() || exportStatus.status.isExpired()) {
        // Export failed or expired, mark job as failed
        const errorMessage = exportStatus.errorMessage ?? `Export ${exportStatus.status.toString().toLowerCase()}`;
        const updatedJob = job.transitionToFailed(errorMessage);
        await this.jobRepository.updateJobState(command.jobId, updatedJob.jobState);

        // Publish job failed event
        const jobFailedEvent = new JobFailedEvent({
          jobId: command.jobId,
          exportId: job.exportId,
          userId: job.userId,
          errorMessage,
          failureReason: exportStatus.status.isFailed() ? 'export_failed' : 'export_expired',
        });
        await this.eventPublisher.publish(jobFailedEvent);

        return {
          job: updatedJob,
          isReady: false,
          isFailed: true,
          shouldContinuePolling: false,
        };
      } else if (exportStatus.status.isPending()) {
        // Export still processing, continue polling
        return {
          job,
          isReady: false,
          isFailed: false,
          shouldContinuePolling: true,
        };
      }

      // Unknown status, continue polling
      return {
        job,
        isReady: false,
        isFailed: false,
        shouldContinuePolling: true,
      };
    } catch (error) {
      this.logger.error(`Failed to poll export status for job ${command.jobId}:`, error);

      // Try to mark job as failed
      try {
        const errorMessage = error instanceof Error ? error.message : 'Polling failed';
        const failedJobState = JobStatusVO.failed();
        await this.jobRepository.updateJobState(command.jobId, failedJobState);
      } catch (repoError) {
        this.logger.error(`Failed to update job state for ${command.jobId}:`, repoError);
      }

      throw error;
    }
  }
}
