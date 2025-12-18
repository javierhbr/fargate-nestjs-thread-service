import { ExportJobEntity } from '../../../domain/entities/export-job.entity';
import { JobStateVO } from '../../../domain/value-objects/job-state.vo';

/**
 * Job State Repository Port (Driven Port)
 * Interface for persisting and retrieving export job state
 */
export interface JobStateRepositoryPort {
  /**
   * Save a complete export job with its state
   */
  save(job: ExportJobEntity): Promise<void>;

  /**
   * Find a job by its ID
   */
  findById(jobId: string): Promise<ExportJobEntity | null>;

  /**
   * Update the job state
   * Returns the updated entity to prevent stale data usage
   */
  updateJobState(jobId: string, jobState: JobStateVO): Promise<ExportJobEntity>;

  /**
   * Increment completed task counter
   * Returns the updated entity to prevent stale data usage
   */
  incrementCompletedTasks(jobId: string): Promise<ExportJobEntity>;

  /**
   * Increment failed task counter
   * Returns the updated entity to prevent stale data usage
   */
  incrementFailedTasks(jobId: string, errorMessage?: string): Promise<ExportJobEntity>;

  /**
   * Set the total number of tasks for a job
   * Returns the updated entity to prevent stale data usage
   */
  setTotalTasks(jobId: string, totalTasks: number): Promise<ExportJobEntity>;

  /**
   * Delete a job (cleanup)
   */
  delete(jobId: string): Promise<void>;

  /**
   * Find jobs by status (for monitoring/cleanup)
   */
  findByStatus(status: string, limit?: number): Promise<ExportJobEntity[]>;
}
