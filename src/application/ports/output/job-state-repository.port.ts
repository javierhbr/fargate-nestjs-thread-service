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
   */
  updateJobState(jobId: string, jobState: JobStateVO): Promise<void>;

  /**
   * Increment completed task counter
   */
  incrementCompletedTasks(jobId: string): Promise<void>;

  /**
   * Increment failed task counter
   */
  incrementFailedTasks(jobId: string, errorMessage?: string): Promise<void>;

  /**
   * Set the total number of tasks for a job
   */
  setTotalTasks(jobId: string, totalTasks: number): Promise<void>;

  /**
   * Delete a job (cleanup)
   */
  delete(jobId: string): Promise<void>;

  /**
   * Find jobs by status (for monitoring/cleanup)
   */
  findByStatus(status: string, limit?: number): Promise<ExportJobEntity[]>;
}
