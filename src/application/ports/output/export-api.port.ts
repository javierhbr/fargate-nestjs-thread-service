import { ExportStatusVO } from '../../../domain/value-objects/export-status.vo';

/**
 * Export API Response
 */
export interface ExportApiResponse {
  exportId: string;
  status: ExportStatusVO;
  downloadUrls?: string[];
  errorMessage?: string;
  estimatedCompletionTime?: Date;
}

/**
 * Start Export Request
 */
export interface StartExportRequest {
  userId: string;
  exportType: string;
  filters?: Record<string, unknown>;
  format?: string;
}

/**
 * Export API Port (Driven Port)
 * Interface for communicating with the external Export API
 */
export interface ExportApiPort {
  /**
   * Start a new export job in the external system
   */
  startExport(request: StartExportRequest): Promise<ExportApiResponse>;

  /**
   * Get the current status of an export
   */
  getExportStatus(exportId: string): Promise<ExportApiResponse>;

  /**
   * Poll the export status until it reaches a terminal state
   * @param exportId - The export ID to poll
   * @param maxAttempts - Maximum number of polling attempts
   * @param intervalMs - Interval between polls in milliseconds
   */
  pollUntilReady(
    exportId: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<ExportApiResponse>;

  /**
   * Cancel an export (if supported by the API)
   */
  cancelExport(exportId: string): Promise<void>;
}
