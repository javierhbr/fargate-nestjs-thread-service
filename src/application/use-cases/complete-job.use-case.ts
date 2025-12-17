import { Injectable, Logger } from '@nestjs/common';
import {
  CompleteJobCommand,
  CompleteJobPort,
  CompleteJobResult,
} from '../ports/input/complete-job.port';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { EventPublisherPort } from '../ports/output/event-publisher.port';
import { StepFunctionsPort } from '../ports/output/step-functions.port';
import { TaskCompletedEvent } from '../../domain/events/task-completed.event';
import { TaskFailedEvent } from '../../domain/events/task-failed.event';
import { JobCompletedEvent } from '../../domain/events/job-completed.event';

/**
 * Complete Job Use Case
 * Handles updating job state after a task completes and checking if all tasks are done
 */
@Injectable()
export class CompleteJobUseCase implements CompleteJobPort {
  private readonly logger = new Logger(CompleteJobUseCase.name);

  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly eventPublisher: EventPublisherPort,
    private readonly stepFunctions: StepFunctionsPort,
  ) {}

  async execute(command: CompleteJobCommand): Promise<CompleteJobResult> {
    this.logger.debug(
      `Processing task completion for job ${command.jobId}, task ${command.taskId}`,
    );

    try {
      // Retrieve job
      let job = await this.jobRepository.findById(command.jobId);
      if (!job) {
        throw new Error(`Job ${command.jobId} not found`);
      }

      // Update task counters
      if (command.success) {
        await this.jobRepository.incrementCompletedTasks(command.jobId);
        job = job.incrementCompletedTasks();

        // Publish task completed event
        const taskCompletedEvent = new TaskCompletedEvent({
          taskId: command.taskId,
          jobId: command.jobId,
          fileName: 'unknown', // Would need to be passed in command if needed
          s3OutputKey: 'unknown',
          fileSize: 0,
          processingDurationMs: 0,
          retryCount: 0,
        });
        this.eventPublisher.publishAsync(taskCompletedEvent);

        this.logger.debug(
          `Task ${command.taskId} completed successfully. Progress: ${job.completedTasks}/${job.totalTasks}`,
        );
      } else {
        await this.jobRepository.incrementFailedTasks(
          command.jobId,
          command.errorMessage,
        );
        job = job.incrementFailedTasks(command.errorMessage);

        // Publish task failed event
        const taskFailedEvent = new TaskFailedEvent({
          taskId: command.taskId,
          jobId: command.jobId,
          fileName: 'unknown',
          errorMessage: command.errorMessage ?? 'Unknown error',
          retryCount: 0,
          willRetry: false,
        });
        this.eventPublisher.publishAsync(taskFailedEvent);

        this.logger.warn(
          `Task ${command.taskId} failed: ${command.errorMessage}. Progress: ${job.completedTasks}/${job.totalTasks} (${job.failedTasks} failed)`,
        );
      }

      // Check if job is complete
      const isJobComplete = job.isComplete();

      if (isJobComplete) {
        const allTasksSucceeded = job.allTasksSucceeded();
        const updatedJob = job.transitionToCompleted();
        await this.jobRepository.updateJobState(command.jobId, updatedJob.jobState);

        this.logger.log(
          `Job ${command.jobId} completed. Total: ${job.totalTasks}, Completed: ${job.completedTasks}, Failed: ${job.failedTasks}`,
        );

        // Publish job completed event
        const durationMs =
          updatedJob.jobState.updatedAt.getTime() -
          updatedJob.jobState.createdAt.getTime();
        const jobCompletedEvent = new JobCompletedEvent({
          jobId: command.jobId,
          exportId: updatedJob.exportId,
          userId: updatedJob.userId,
          totalTasks: job.totalTasks,
          completedTasks: job.completedTasks,
          failedTasks: job.failedTasks,
          success: allTasksSucceeded,
          durationMs,
        });
        await this.eventPublisher.publish(jobCompletedEvent);

        // Send Step Functions callback if taskToken exists
        if (updatedJob.hasTaskToken()) {
          await this.sendStepFunctionsCallback(updatedJob, allTasksSucceeded, durationMs);
        }

        return {
          job: updatedJob,
          isJobComplete: true,
          allTasksSucceeded,
        };
      }

      return {
        job,
        isJobComplete: false,
        allTasksSucceeded: false,
      };
    } catch (error) {
      this.logger.error(`Failed to complete job ${command.jobId}:`, error);
      throw error;
    }
  }

  /**
   * Send callback to Step Functions when job completes
   */
  private async sendStepFunctionsCallback(
    job: import('../../domain/entities/export-job.entity').ExportJobEntity,
    success: boolean,
    durationMs: number,
  ): Promise<void> {
    const taskToken = job.taskToken!;

    try {
      if (success) {
        // Send success callback
        await this.stepFunctions.sendTaskSuccess(taskToken, {
          jobId: job.jobId,
          exportId: job.exportId,
          userId: job.userId,
          status: 'COMPLETED',
          totalTasks: job.totalTasks,
          completedTasks: job.completedTasks,
          failedTasks: job.failedTasks,
          completedAt: job.jobState.updatedAt.toISOString(),
          durationMs,
        });

        this.logger.log(`Sent Step Functions success callback for job ${job.jobId}`);
      } else {
        // Send failure callback
        await this.stepFunctions.sendTaskFailure(taskToken, {
          error: 'JobCompletedWithFailures',
          cause: `Job completed with ${job.failedTasks} failed tasks out of ${job.totalTasks} total`,
          jobId: job.jobId,
          exportId: job.exportId,
          totalTasks: job.totalTasks,
          completedTasks: job.completedTasks,
          failedTasks: job.failedTasks,
        });

        this.logger.log(`Sent Step Functions failure callback for job ${job.jobId}`);
      }
    } catch (error) {
      // Log callback errors but don't fail the job
      this.logger.error(
        `Failed to send Step Functions callback for job ${job.jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Don't throw - callback failures shouldn't fail the job
    }
  }
}
