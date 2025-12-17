import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { HttpClientService } from '../../shared/http/http-client.service';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';
import {
  ExportApiResponse,
  ExportApiStatus,
  ExportApiStartResponse,
} from '../interfaces/export-api-response.interface';

@Injectable()
export class ExportApiService {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;

  constructor(
    private readonly httpClient: HttpClientService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const exportApiConfig = this.configService.get('exportApi', { infer: true })!;

    this.baseUrl = exportApiConfig.baseUrl;
    this.timeout = exportApiConfig.timeout;
    this.maxRetries = exportApiConfig.maxRetries;

    this.logger.setContext(ExportApiService.name);
  }

  async startExport(
    exportId: string,
    userId: string,
    parameters?: Record<string, unknown>,
  ): Promise<ExportApiStartResponse> {
    const url = `${this.baseUrl}/exports`;

    this.logger.info({ exportId, userId }, 'Starting export via API');

    const response = await this.httpClient.post<ExportApiStartResponse>(
      url,
      {
        exportId,
        userId,
        parameters,
      },
      {
        timeout: this.timeout,
        maxRetries: this.maxRetries,
      },
    );

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      throw new Error(`Export API returned status ${response.statusCode}`);
    }

    return response.body;
  }

  async getExportStatus(exportId: string): Promise<ExportApiResponse> {
    const url = `${this.baseUrl}/exports/${exportId}`;

    this.logger.debug({ exportId }, 'Checking export status');

    const response = await this.httpClient.get<ExportApiResponse>(url, {
      timeout: this.timeout,
      maxRetries: this.maxRetries,
    });

    if (response.statusCode !== 200) {
      throw new Error(`Export API returned status ${response.statusCode}`);
    }

    return response.body;
  }

  async pollUntilReady(
    exportId: string,
    pollingIntervalMs: number,
    maxAttempts: number,
  ): Promise<ExportApiResponse> {
    this.logger.info(
      { exportId, pollingIntervalMs, maxAttempts },
      'Starting poll for export completion',
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.getExportStatus(exportId);

      this.logger.debug({ exportId, attempt, status: status.status }, 'Poll attempt');

      if (status.status === ExportApiStatus.READY) {
        this.logger.info({ exportId, attempts: attempt }, 'Export is ready');
        return status;
      }

      if (status.status === ExportApiStatus.FAILED) {
        this.logger.error({ exportId, error: status.error }, 'Export failed');
        throw new Error(`Export failed: ${status.error?.message || 'Unknown error'}`);
      }

      if (status.status === ExportApiStatus.EXPIRED) {
        this.logger.error({ exportId }, 'Export expired');
        throw new Error('Export expired before completion');
      }

      if (attempt < maxAttempts) {
        await this.delay(pollingIntervalMs);
      }
    }

    throw new Error(`Export polling timed out after ${maxAttempts} attempts`);
  }

  isTerminalStatus(status: ExportApiStatus): boolean {
    return [
      ExportApiStatus.READY,
      ExportApiStatus.FAILED,
      ExportApiStatus.EXPIRED,
    ].includes(status);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
