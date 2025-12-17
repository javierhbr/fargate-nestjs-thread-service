import { ExportJobEntity } from '../../../domain/entities/export-job.entity';

/**
 * Start Export Job Command
 */
export interface StartExportJobCommand {
  jobId: string;
  exportId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Start Export Job Result
 */
export interface StartExportJobResult {
  job: ExportJobEntity;
  needsPolling: boolean;
  canStartDownloading: boolean;
}

/**
 * Start Export Job Port (Driving Port / Use Case Interface)
 * Handles the initiation of a new export job
 */
export interface StartExportJobPort {
  /**
   * Execute the start export job use case
   */
  execute(command: StartExportJobCommand): Promise<StartExportJobResult>;
}
