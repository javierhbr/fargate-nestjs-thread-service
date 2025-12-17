import { Injectable, Logger } from '@nestjs/common';
import { JobStateRepositoryPort } from '../../../application/ports/output/job-state-repository.port';
import { ExportJobEntity } from '../../../domain/entities/export-job.entity';
import { JobStateVO } from '../../../domain/value-objects/job-state.vo';
import { JobStatusVO } from '../../../domain/value-objects/job-status.vo';
import { DynamoDbService, JobState } from '../../../shared/aws/dynamodb/dynamodb.service';

/**
 * DynamoDB Job Repository Adapter
 * Implements JobStateRepositoryPort using DynamoDB
 */
@Injectable()
export class DynamoDbJobRepositoryAdapter implements JobStateRepositoryPort {
  private readonly logger = new Logger(DynamoDbJobRepositoryAdapter.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async save(job: ExportJobEntity): Promise<void> {
    const jobState = this.toJobState(job);

    await this.dynamoDb.createJobState(jobState);

    this.logger.log(`Saved job ${job.jobId} to DynamoDB`);
  }

  async findById(jobId: string): Promise<ExportJobEntity | null> {
    const jobState = await this.dynamoDb.getJobState(jobId);

    if (!jobState) {
      return null;
    }

    return this.toDomainEntity(jobState);
  }

  async updateJobState(jobId: string, jobState: JobStateVO): Promise<void> {
    await this.dynamoDb.updateJobStatus(
      jobId,
      this.mapDomainStatusToDbStatus(jobState.status.toString()),
      {
        totalTasks: jobState.totalTasks,
        completedTasks: jobState.completedTasks,
        failedTasks: jobState.failedTasks,
        ...(jobState.errorMessage && {
          error: {
            code: 'JOB_ERROR',
            message: jobState.errorMessage,
          },
        }),
      },
    );

    this.logger.debug(`Updated job state for ${jobId}`);
  }

  async incrementCompletedTasks(jobId: string): Promise<void> {
    await this.dynamoDb.incrementTaskCount(jobId, 'completedTasks');
    this.logger.debug(`Incremented completed tasks for job ${jobId}`);
  }

  async incrementFailedTasks(jobId: string, errorMessage?: string): Promise<void> {
    await this.dynamoDb.incrementTaskCount(jobId, 'failedTasks');

    if (errorMessage) {
      await this.dynamoDb.updateJobStatus(
        jobId,
        this.mapDomainStatusToDbStatus('FAILED'),
        {
          error: {
            code: 'TASK_ERROR',
            message: errorMessage,
          },
        },
      );
    }

    this.logger.debug(`Incremented failed tasks for job ${jobId}`);
  }

  async setTotalTasks(jobId: string, totalTasks: number): Promise<void> {
    await this.dynamoDb.setTotalTasks(jobId, totalTasks);
    this.logger.debug(`Set total tasks to ${totalTasks} for job ${jobId}`);
  }

  async delete(jobId: string): Promise<void> {
    await this.dynamoDb.deleteJobState(jobId);
    this.logger.log(`Deleted job ${jobId} from DynamoDB`);
  }

  async findByStatus(status: string, limit?: number): Promise<ExportJobEntity[]> {
    const dbStatus = this.mapDomainStatusToDbStatus(status);
    const jobStates = await this.dynamoDb.getJobsByStatus(dbStatus, limit);

    return jobStates.map((jobState) => this.toDomainEntity(jobState));
  }

  /**
   * Convert domain entity to DynamoDB JobState
   */
  private toJobState(job: ExportJobEntity): Omit<JobState, 'updatedAt'> {
    return {
      jobId: job.jobId,
      exportId: job.exportId,
      userId: job.userId,
      status: this.mapDomainStatusToDbStatus(job.status.toString()),
      totalTasks: job.totalTasks,
      completedTasks: job.completedTasks,
      failedTasks: job.failedTasks,
      createdAt: job.jobState.createdAt.toISOString(),
      metadata: job.metadata,
      ...(job.taskToken && { taskToken: job.taskToken }),
      ...(job.jobState.errorMessage && {
        error: {
          code: 'JOB_ERROR',
          message: job.jobState.errorMessage,
        },
      }),
    };
  }

  /**
   * Convert DynamoDB JobState to domain entity
   */
  private toDomainEntity(jobState: JobState): ExportJobEntity {
    const domainJobState = JobStateVO.create({
      totalTasks: jobState.totalTasks,
      completedTasks: jobState.completedTasks,
      failedTasks: jobState.failedTasks,
      status: JobStatusVO.fromString(this.mapDbStatusToDomainStatus(jobState.status)),
      errorMessage: jobState.error?.message,
      createdAt: new Date(jobState.createdAt),
      updatedAt: new Date(jobState.updatedAt),
    });

    return ExportJobEntity.create({
      jobId: jobState.jobId,
      exportId: jobState.exportId,
      userId: jobState.userId,
      jobState: domainJobState,
      metadata: jobState.metadata,
      taskToken: jobState.taskToken,
    });
  }

  /**
   * Map domain status to database status (existing enum in codebase)
   */
  private mapDomainStatusToDbStatus(domainStatus: string): string {
    // Map domain status values to existing database enum values
    const statusMap: Record<string, string> = {
      PENDING: 'PENDING',
      PROCESSING: 'PROCESSING',
      POLLING: 'POLLING',
      DOWNLOADING: 'DOWNLOADING',
      COMPLETED: 'COMPLETED',
      FAILED: 'FAILED',
    };

    return statusMap[domainStatus.toUpperCase()] ?? 'PENDING';
  }

  /**
   * Map database status to domain status
   */
  private mapDbStatusToDomainStatus(dbStatus: string): string {
    // For now, they're the same, but this allows for future divergence
    return dbStatus;
  }
}
