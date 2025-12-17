import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { SqsService, SqsConsumerBase } from '../../shared/aws/sqs';
import { SqsMessageEnvelope } from '../../shared/aws/sqs/sqs-consumer.base';
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

@Injectable()
export class ExportJobConsumer extends SqsConsumerBase<ExportJobMessage> {
  constructor(
    sqsService: SqsService,
    logger: PinoLoggerService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly dynamoDb: DynamoDbService,
    private readonly exportApi: ExportApiService,
    private readonly pollingService: PollingService,
    private readonly taskDispatcher: TaskDispatcherService,
  ) {
    const sqsConfig = configService.get('sqs', { infer: true })!;

    super(sqsService, logger, {
      queueUrl: sqsConfig.exportJobsUrl,
      batchSize: sqsConfig.maxMessages,
    });

    this.logger.setContext(ExportJobConsumer.name);
  }

  protected async processMessage(
    envelope: SqsMessageEnvelope<ExportJobMessage>,
  ): Promise<void> {
    const { body, messageId } = envelope;

    // Validate message
    let validatedMessage;
    try {
      validatedMessage = validateExportJobMessage(body);
    } catch (error) {
      this.logger.error(
        { messageId, error: (error as Error).message },
        'Invalid export job message',
      );
      return; // Delete invalid message
    }

    const { jobId, exportId, userId, metadata } = validatedMessage;
    const jobLogger = this.logger.withJobId(jobId);

    jobLogger.info({ exportId, userId }, 'Processing export job');

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
      await this.dynamoDb.updateJobStatus(jobId, ExportJobStatus.FAILED, {
        error: {
          code: 'PROCESSING_ERROR',
          message: (error as Error).message,
        },
      });

      throw error; // Re-throw to trigger retry via SQS
    }
  }

  protected async handleProcessingError(
    envelope: SqsMessageEnvelope<ExportJobMessage>,
    error: Error,
  ): Promise<void> {
    const maxRetries = 3;

    if (envelope.approximateReceiveCount >= maxRetries) {
      this.logger.error(
        {
          messageId: envelope.messageId,
          jobId: envelope.body?.jobId,
          receiveCount: envelope.approximateReceiveCount,
        },
        'Max retries exceeded, message will go to DLQ',
      );
    } else {
      this.logger.warn(
        {
          messageId: envelope.messageId,
          jobId: envelope.body?.jobId,
          receiveCount: envelope.approximateReceiveCount,
          error: error.message,
        },
        'Message processing failed, will retry',
      );
    }
  }
}
