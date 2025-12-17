import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { SqsService, SqsConsumerBase } from '../../shared/aws/sqs';
import { SqsMessageEnvelope } from '../../shared/aws/sqs/sqs-consumer.base';
import { DynamoDbService } from '../../shared/aws/dynamodb/dynamodb.service';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';
import {
  DownloadTask,
  DownloadTaskMessage,
} from '../../shared/interfaces/download-task.interface';
import { PoolManagerService } from '../../worker-pool/pool-manager.service';
import { validateDownloadTaskMessage } from '../dto/download-task.dto';
import { TaskDispatcherService } from '../services/task-dispatcher.service';

@Injectable()
export class OverflowConsumer extends SqsConsumerBase<DownloadTaskMessage> {
  constructor(
    sqsService: SqsService,
    logger: PinoLoggerService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly poolManager: PoolManagerService,
    private readonly dynamoDb: DynamoDbService,
    private readonly taskDispatcher: TaskDispatcherService,
  ) {
    const sqsConfig = configService.get('sqs', { infer: true })!;

    super(sqsService, logger, {
      queueUrl: sqsConfig.downloadTasksUrl,
      batchSize: sqsConfig.maxMessages,
    });

    this.logger.setContext(OverflowConsumer.name);
  }

  /**
   * Only receive messages when the pool has capacity
   */
  protected async shouldReceiveMessages(): Promise<boolean> {
    const hasCapacity = this.poolManager.canAcceptTask();
    const idleWorkers = this.poolManager.getIdleWorkerCount();

    this.logger.debug(
      { hasCapacity, idleWorkers },
      'Checking pool capacity for overflow',
    );

    return hasCapacity && idleWorkers > 0;
  }

  protected async processMessage(
    envelope: SqsMessageEnvelope<DownloadTaskMessage>,
  ): Promise<void> {
    const { body, messageId } = envelope;

    // Validate message
    let validatedMessage;
    try {
      validatedMessage = validateDownloadTaskMessage(body);
    } catch (error) {
      this.logger.error(
        { messageId, error: (error as Error).message },
        'Invalid download task message',
      );
      return; // Delete invalid message
    }

    const { taskId, jobId, exportId } = validatedMessage;
    const taskLogger = this.logger.withTaskId(taskId);

    taskLogger.info({ jobId, exportId }, 'Processing overflow download task');

    // Convert to DownloadTask
    const task: DownloadTask = {
      taskId: validatedMessage.taskId,
      jobId: validatedMessage.jobId,
      exportId: validatedMessage.exportId,
      downloadUrl: validatedMessage.downloadUrl,
      fileName: validatedMessage.fileName,
      fileSize: validatedMessage.fileSize,
      checksum: validatedMessage.checksum,
      outputKey: validatedMessage.outputKey,
      metadata: validatedMessage.metadata,
      retryCount: envelope.approximateReceiveCount - 1,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
    };

    try {
      // Submit to worker pool and wait for result
      const result = await this.poolManager.submitTask(task);

      if (result.success) {
        taskLogger.info(
          { outputKey: result.outputKey, size: result.outputSize },
          'Task completed successfully',
        );

        await this.dynamoDb.incrementTaskCount(jobId, 'completedTasks');
      } else {
        taskLogger.error({ error: result.error }, 'Task failed');

        await this.dynamoDb.incrementTaskCount(jobId, 'failedTasks');
      }

      // Check job completion
      await this.taskDispatcher.checkJobCompletion(jobId);
    } catch (error) {
      taskLogger.error(
        { error: (error as Error).message },
        'Error processing overflow task',
      );
      throw error; // Re-throw to retry
    }
  }

  protected async handleProcessingError(
    envelope: SqsMessageEnvelope<DownloadTaskMessage>,
    error: Error,
  ): Promise<void> {
    const maxRetries = 3;

    if (envelope.approximateReceiveCount >= maxRetries) {
      this.logger.error(
        {
          messageId: envelope.messageId,
          taskId: envelope.body?.taskId,
          jobId: envelope.body?.jobId,
          receiveCount: envelope.approximateReceiveCount,
        },
        'Max retries exceeded for download task',
      );

      // Mark task as failed in state
      if (envelope.body?.jobId) {
        await this.dynamoDb.incrementTaskCount(envelope.body.jobId, 'failedTasks');
        await this.taskDispatcher.checkJobCompletion(envelope.body.jobId);
      }
    } else {
      this.logger.warn(
        {
          messageId: envelope.messageId,
          taskId: envelope.body?.taskId,
          receiveCount: envelope.approximateReceiveCount,
          error: error.message,
        },
        'Download task failed, will retry',
      );
    }
  }
}
