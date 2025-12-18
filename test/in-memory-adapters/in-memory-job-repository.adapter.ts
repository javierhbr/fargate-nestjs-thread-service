import { Injectable } from '@nestjs/common';
import { JobStateRepositoryPort } from '../../src/application/ports/output/job-state-repository.port';
import { ExportJobEntity } from '../../src/domain/entities/export-job.entity';
import { JobStateVO } from '../../src/domain/value-objects/job-state.vo';

/**
 * In-Memory Job State Repository Adapter
 * For ATDD testing - stores jobs in memory without external dependencies
 */
@Injectable()
export class InMemoryJobRepositoryAdapter implements JobStateRepositoryPort {
  private jobs: Map<string, ExportJobEntity> = new Map();

  async save(job: ExportJobEntity): Promise<void> {
    // Deep clone to avoid reference issues
    const clonedJob = this.cloneJob(job);
    this.jobs.set(job.jobId, clonedJob);
  }

  async findById(jobId: string): Promise<ExportJobEntity | null> {
    const job = this.jobs.get(jobId);
    return job ? this.cloneJob(job) : null;
  }

  async updateJobState(jobId: string, jobState: JobStateVO): Promise<ExportJobEntity> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Create a new entity with the updated job state (entities are immutable)
    const updatedJob = job.withJobState(jobState);
    this.jobs.set(jobId, updatedJob);

    // Return cloned entity to prevent stale data usage
    return this.cloneJob(updatedJob);
  }

  async incrementCompletedTasks(jobId: string): Promise<ExportJobEntity> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedJob = job.incrementCompletedTasks();
    this.jobs.set(jobId, updatedJob);

    // Return cloned entity to prevent stale data usage
    return this.cloneJob(updatedJob);
  }

  async incrementFailedTasks(
    jobId: string,
    errorMessage?: string,
  ): Promise<ExportJobEntity> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedJob = job.incrementFailedTasks(errorMessage);
    this.jobs.set(jobId, updatedJob);

    // Return cloned entity to prevent stale data usage
    return this.cloneJob(updatedJob);
  }

  async setTotalTasks(jobId: string, totalTasks: number): Promise<ExportJobEntity> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const updatedJob = job.setTotalTasks(totalTasks);
    this.jobs.set(jobId, updatedJob);

    // Return cloned entity to prevent stale data usage
    return this.cloneJob(updatedJob);
  }

  async delete(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  async findByStatus(status: string, limit?: number): Promise<ExportJobEntity[]> {
    const jobs = Array.from(this.jobs.values()).filter(
      (job) => job.jobState.status.value === status,
    );

    if (limit) {
      return jobs.slice(0, limit).map((job) => this.cloneJob(job));
    }

    return jobs.map((job) => this.cloneJob(job));
  }

  // Helper methods for testing
  clear(): void {
    this.jobs.clear();
  }

  getAllJobs(): ExportJobEntity[] {
    return Array.from(this.jobs.values()).map((job) => this.cloneJob(job));
  }

  getJobCount(): number {
    return this.jobs.size;
  }

  private cloneJob(job: ExportJobEntity): ExportJobEntity {
    // Create a new instance using the factory method to preserve entity invariants
    return ExportJobEntity.create({
      jobId: job.jobId,
      exportId: job.exportId,
      userId: job.userId,
      jobState: job.jobState,
      metadata: job.metadata,
      maxPollingAttempts: job.maxPollingAttempts,
      pollingIntervalMs: job.pollingIntervalMs,
      downloadTasks: [...job.downloadTasks], // Convert readonly array to mutable
      taskToken: job.taskToken,
    });
  }
}
