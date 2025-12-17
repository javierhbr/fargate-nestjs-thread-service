import { Injectable, Logger } from '@nestjs/common';
import {
  StartExportJobCommand,
  StartExportJobPort,
  StartExportJobResult,
} from '../ports/input/start-export-job.port';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { ExportApiPort } from '../ports/output/export-api.port';
import { EventPublisherPort } from '../ports/output/event-publisher.port';
import { ExportJobEntity } from '../../domain/entities/export-job.entity';
import { JobStateVO } from '../../domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../domain/value-objects/job-status.vo';
import { JobCreatedEvent } from '../../domain/events/job-created.event';
import { JobFailedEvent } from '../../domain/events/job-failed.event';

/**
 * Start Export Job Use Case
 * Handles the creation and initialization of a new export job
 */
@Injectable()
export class StartExportJobUseCase implements StartExportJobPort {
  private readonly logger = new Logger(StartExportJobUseCase.name);

  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly exportApi: ExportApiPort,
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: StartExportJobCommand): Promise<StartExportJobResult> {
    this.logger.log(`Starting export job: ${command.jobId} for export: ${command.exportId}`);

    try {
      // Create initial job entity
      const initialJobState = JobStateVO.create({
        status: JobStatusVO.pending(),
      });

      let job = ExportJobEntity.create({
        jobId: command.jobId,
        exportId: command.exportId,
        userId: command.userId,
        jobState: initialJobState,
        metadata: command.metadata,
      });

      // Save initial job state
      await this.jobRepository.save(job);

      // Publish job created event
      const jobCreatedEvent = new JobCreatedEvent({
        jobId: command.jobId,
        exportId: command.exportId,
        userId: command.userId,
        metadata: command.metadata,
      });
      await this.eventPublisher.publish(jobCreatedEvent);

      // Check export status from external API
      const exportStatus = await this.exportApi.getExportStatus(command.exportId);

      this.logger.log(`Export ${command.exportId} status: ${exportStatus.status.toString()}`);

      // Determine next action based on export status
      if (exportStatus.status.isReady()) {
        // Export is ready, can start downloading immediately
        job = job.withJobState(job.jobState.withStatus(JobStatusVO.processing()));
        await this.jobRepository.updateJobState(command.jobId, job.jobState);

        return {
          job,
          needsPolling: false,
          canStartDownloading: true,
        };
      } else if (exportStatus.status.isPending()) {
        // Export is still processing, need to poll
        job = job.transitionToPolling();
        await this.jobRepository.updateJobState(command.jobId, job.jobState);

        return {
          job,
          needsPolling: true,
          canStartDownloading: false,
        };
      } else if (exportStatus.status.isFailed() || exportStatus.status.isExpired()) {
        // Export failed or expired, mark job as failed
        const errorMessage = exportStatus.errorMessage ?? `Export ${exportStatus.status.toString().toLowerCase()}`;
        job = job.transitionToFailed(errorMessage);
        await this.jobRepository.updateJobState(command.jobId, job.jobState);

        // Publish job failed event
        const jobFailedEvent = new JobFailedEvent({
          jobId: command.jobId,
          exportId: command.exportId,
          userId: command.userId,
          errorMessage,
          failureReason: exportStatus.status.isFailed() ? 'export_failed' : 'export_expired',
        });
        await this.eventPublisher.publish(jobFailedEvent);

        return {
          job,
          needsPolling: false,
          canStartDownloading: false,
        };
      }

      // Default case: needs polling
      return {
        job,
        needsPolling: true,
        canStartDownloading: false,
      };
    } catch (error) {
      this.logger.error(`Failed to start export job ${command.jobId}:`, error);

      // Try to mark job as failed in repository
      try {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const failedJobState = JobStateVO.create({ status: JobStatusVO.failed(), errorMessage });
        await this.jobRepository.updateJobState(command.jobId, failedJobState);
      } catch (repoError) {
        this.logger.error(`Failed to update job state for ${command.jobId}:`, repoError);
      }

      throw error;
    }
  }
}
