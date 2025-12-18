import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
import { DynamoDbService, JobState } from '../../shared/aws/dynamodb/dynamodb.service';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';
import {
  ExportJobMessage,
  ExportJobStatus,
} from '../../shared/interfaces/export-job.interface';
import { ExportApiService } from '../services/export-api.service';
import { PollingService } from '../services/polling.service';
import { TaskDispatcherService } from '../services/task-dispatcher.service';
import { validateExportJobMessage } from '../dto/export-job.dto';
import { ExportApiStatus } from '../interfaces/export-api-response.interface';

/**
 * Export Job Consumer
 * Listens to export-jobs-queue for new export job requests
 * Uses @ssut/nestjs-sqs for message consumption
 */
@Injectable()
export class ExportJobConsumer {
  constructor(
    private readonly logger: PinoLoggerService,
    private readonly dynamoDb: DynamoDbService,
    private readonly exportApi: ExportApiService,
    private readonly pollingService: PollingService,
    private readonly taskDispatcher: TaskDispatcherService,
  ) {
    this.logger.setContext(ExportJobConsumer.name);
  }

  @SqsMessageHandler('export-jobs-queue', false)
  async handleMessage(message: Message): Promise<void> {
    const messageId = message.MessageId || 'unknown';

    // Parse message body
    let body: ExportJobMessage;
    try {
      body = JSON.parse(message.Body || '{}');
    } catch (error) {
      this.logger.error(
        { messageId, error: (error as Error).message },
        'Failed to parse message body',
      );
      // Return without throwing to delete invalid message
      return;
    }

    // Validate message
    let validatedMessage: ExportJobMessage;
    try {
      validatedMessage = validateExportJobMessage(body);
    } catch (error) {
      this.logger.error(
        { messageId, error: (error as Error).message },
        'Invalid export job message',
      );
      // Return without throwing to delete invalid message
      return;
    }

    const { jobId, exportId, userId, metadata, taskToken } = validatedMessage;
    const jobLogger = this.logger.withJobId(jobId);

    jobLogger.info(
      { exportId, userId, hasTaskToken: !!taskToken, messageId },
      'Processing export job',
    );

    try {
      // Create job state
      const jobState: Omit<JobState, 'updatedAt'> = {
        jobId,
        exportId,
        userId,
        status: ExportJobStatus.PROCESSING,
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        createdAt: new Date().toISOString(),
        metadata,
        ...(taskToken && { taskToken }), // Include taskToken if present
      };

      await this.dynamoDb.createJobState(jobState);

      // Check export status
      const exportStatus = await this.exportApi.getExportStatus(exportId);

      jobLogger.info({ exportStatus: exportStatus.status }, 'Export API status');

      switch (exportStatus.status) {
        case ExportApiStatus.READY:
          // Export already ready, dispatch download tasks immediately
          await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.DOWNLOADING);
          await this.taskDispatcher.dispatchDownloadTasks(
            jobId,
            exportId,
            exportStatus.downloadUrls || [],
          );
          break;

        case ExportApiStatus.PENDING:
        case ExportApiStatus.PROCESSING:
          // Add to polling queue
          await this.pollingService.addJobToPolling(jobId, exportId, userId);
          break;

        case ExportApiStatus.FAILED:
          await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
            error: {
              code: 'EXPORT_API_FAILED',
              message: exportStatus.error?.message || 'Export failed',
            },
          });
          break;

        case ExportApiStatus.EXPIRED:
          await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
            error: {
              code: 'EXPORT_EXPIRED',
              message: 'Export expired',
            },
          });
          break;

        default:
          jobLogger.warn({ status: exportStatus.status }, 'Unknown export status');
          // Add to polling to monitor
          await this.pollingService.addJobToPolling(jobId, exportId, userId);
      }

      jobLogger.info('Export job processed successfully');
    } catch (error) {
      jobLogger.error({ error: (error as Error).message }, 'Error processing export job');

      // Update job state to failed
      try {
        await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
          error: {
            code: 'PROCESSING_ERROR',
            message: (error as Error).message,
          },
        });
      } catch (updateError) {
        jobLogger.error(
          { error: (updateError as Error).message },
          'Failed to update job status to failed',
        );
      }

      // Re-throw to trigger SQS retry (message will not be deleted)
      throw error;
    }
  }
}
