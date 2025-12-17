import { ExportJobEntity } from '../../../domain/entities/export-job.entity';

/**
 * Poll Export Status Command
 */
export interface PollExportStatusCommand {
  jobId: string;
}

/**
 * Poll Export Status Result
 */
export interface PollExportStatusResult {
  job: ExportJobEntity;
  isReady: boolean;
  isFailed: boolean;
  shouldContinuePolling: boolean;
  downloadUrls?: string[];
}

/**
 * Poll Export Status Port (Driving Port / Use Case Interface)
 * Handles polling the external export API for status updates
 */
export interface PollExportStatusPort {
  /**
   * Execute the poll export status use case
   */
  execute(command: PollExportStatusCommand): Promise<PollExportStatusResult>;
}
