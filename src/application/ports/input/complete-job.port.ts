import { ExportJobEntity } from '../../../domain/entities/export-job.entity';

/**
 * Complete Job Command
 */
export interface CompleteJobCommand {
  jobId: string;
  taskId: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Complete Job Result
 */
export interface CompleteJobResult {
  job: ExportJobEntity;
  isJobComplete: boolean;
  allTasksSucceeded: boolean;
}

/**
 * Complete Job Port (Driving Port / Use Case Interface)
 * Handles updating job state after a task completes and checking if the job is done
 */
export interface CompleteJobPort {
  /**
   * Execute the complete job use case
   */
  execute(command: CompleteJobCommand): Promise<CompleteJobResult>;
}
