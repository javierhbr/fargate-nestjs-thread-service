import { Injectable } from '@nestjs/common';
import {
  ExportApiPort,
  ExportApiResponse,
  StartExportRequest,
} from '../../src/application/ports/output/export-api.port';
import { ExportStatusVO } from '../../src/domain/value-objects/export-status.vo';

interface SimulatedExport {
  exportId: string;
  userId: string;
  status: ExportStatusVO;
  downloadUrls?: string[];
  errorMessage?: string;
  estimatedCompletionTime?: Date;
  pollCount: number;
  transitionAtPoll?: number; // Which poll attempt triggers status change
}

/**
 * In-Memory Export API Adapter
 * For ATDD testing - simulates external export API behavior
 */
@Injectable()
export class InMemoryExportApiAdapter implements ExportApiPort {
  private exports: Map<string, SimulatedExport> = new Map();
  private nextExportId = 1;

  async startExport(request: StartExportRequest): Promise<ExportApiResponse> {
    const exportId = `export-${this.nextExportId++}`;
    const exportData: SimulatedExport = {
      exportId,
      userId: request.userId,
      status: ExportStatusVO.pending(),
      pollCount: 0,
    };

    this.exports.set(exportId, exportData);

    return {
      exportId,
      status: exportData.status,
      estimatedCompletionTime: exportData.estimatedCompletionTime,
    };
  }

  async getExportStatus(exportId: string): Promise<ExportApiResponse> {
    const exportData = this.exports.get(exportId);

    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    // Increment poll count
    exportData.pollCount++;

    // Check if we should transition status based on poll count
    if (exportData.transitionAtPoll && exportData.pollCount >= exportData.transitionAtPoll) {
      this.applyScheduledTransition(exportData);
    }

    return {
      exportId: exportData.exportId,
      status: exportData.status,
      downloadUrls: exportData.downloadUrls,
      errorMessage: exportData.errorMessage,
      estimatedCompletionTime: exportData.estimatedCompletionTime,
    };
  }

  async pollUntilReady(
    exportId: string,
    maxAttempts: number,
    intervalMs: number,
  ): Promise<ExportApiResponse> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      const response = await this.getExportStatus(exportId);

      // Terminal states
      if (
        response.status === ExportStatusVO.ready() ||
        response.status === ExportStatusVO.failed() ||
        response.status === ExportStatusVO.expired()
      ) {
        return response;
      }

      attempts++;

      // Simulate delay (in tests this can be 0)
      if (intervalMs > 0) {
        await this.sleep(intervalMs);
      }
    }

    // Max attempts reached, return current status
    return await this.getExportStatus(exportId);
  }

  async cancelExport(exportId: string): Promise<void> {
    const exportData = this.exports.get(exportId);

    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.failed();
    exportData.errorMessage = 'Export cancelled';
  }

  // Test helper methods for configuring export behavior

  /**
   * Configure an export to be immediately ready with download URLs
   */
  configureExportAsReady(exportId: string, downloadUrls: string[]): void {
    const exportData = this.exports.get(exportId);
    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.ready();
    exportData.downloadUrls = downloadUrls;
  }

  /**
   * Configure an export to fail immediately
   */
  configureExportAsFailed(exportId: string, errorMessage: string): void {
    const exportData = this.exports.get(exportId);
    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.failed();
    exportData.errorMessage = errorMessage;
  }

  /**
   * Configure an export to expire
   */
  configureExportAsExpired(exportId: string): void {
    const exportData = this.exports.get(exportId);
    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.expired();
  }

  /**
   * Configure an export to transition to READY after N polls
   */
  configureExportToTransition(
    exportId: string,
    transitionAtPoll: number,
    downloadUrls: string[],
  ): void {
    const exportData = this.exports.get(exportId);
    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.processing();
    exportData.transitionAtPoll = transitionAtPoll;
    exportData.downloadUrls = downloadUrls;
  }

  /**
   * Configure an export to transition to FAILED after N polls
   */
  configureExportToFail(
    exportId: string,
    transitionAtPoll: number,
    errorMessage: string,
  ): void {
    const exportData = this.exports.get(exportId);
    if (!exportData) {
      throw new Error(`Export not found: ${exportId}`);
    }

    exportData.status = ExportStatusVO.processing();
    exportData.transitionAtPoll = transitionAtPoll;
    exportData.errorMessage = errorMessage;
  }

  /**
   * Get the poll count for an export (for assertions)
   */
  getPollCount(exportId: string): number {
    const exportData = this.exports.get(exportId);
    return exportData ? exportData.pollCount : 0;
  }

  /**
   * Create a pre-configured export for testing
   */
  createMockExport(
    exportId: string,
    userId: string,
    status: ExportStatusVO,
    downloadUrls?: string[],
    errorMessage?: string,
  ): void {
    this.exports.set(exportId, {
      exportId,
      userId,
      status,
      downloadUrls,
      errorMessage,
      pollCount: 0,
    });
  }

  clear(): void {
    this.exports.clear();
    this.nextExportId = 1;
  }

  private applyScheduledTransition(exportData: SimulatedExport): void {
    if (exportData.downloadUrls && exportData.downloadUrls.length > 0) {
      exportData.status = ExportStatusVO.ready();
    } else if (exportData.errorMessage) {
      exportData.status = ExportStatusVO.failed();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
