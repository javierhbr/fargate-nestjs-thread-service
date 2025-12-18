import { Injectable } from '@nestjs/common';
import { SqsMessageHandler } from '@ssut/nestjs-sqs';
import { Message } from '@aws-sdk/client-sqs';
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
export class OverflowConsumer {
  constructor(
    private readonly logger: PinoLoggerService,
    private readonly poolManager: PoolManagerService,
    private readonly dynamoDb: DynamoDbService,
    private readonly taskDispatcher: TaskDispatcherService,
  ) {
    this.logger.setContext(OverflowConsumer.name);
  }

  @SqsMessageHandler('download-tasks-queue', false)
  async handleMessage(message: Message): Promise<void> {
    const messageId = message.MessageId || 'unknown';
    const approximateReceiveCount = parseInt(
      message.Attributes?.ApproximateReceiveCount || '1',
      10,
    );

    // Check pool capacity before processing
    const hasCapacity = this.poolManager.canAcceptTask();
    const idleWorkers = this.poolManager.getIdleWorkerCount();

    this.logger.debug(
      { messageId, hasCapacity, idleWorkers },
      'Checking pool capacity for overflow',
    );

    if (!hasCapacity || idleWorkers === 0) {
      this.logger.debug(
        { messageId, hasCapacity, idleWorkers },
        'Pool at capacity or no idle workers, message will be retried',
      );
      // Throw error to make message visible again after visibility timeout
      throw new Error('Pool capacity full, retry later');
    }

    // Parse message body
    let body: DownloadTaskMessage;
    try {
      body = JSON.parse(message.Body || '{}');
    } catch (error) {
      this.logger.error(
        { messageId, error: (error as Error).message },
        'Failed to parse message body',
      );
      return; // Delete invalid message
    }

    // Validate message
    let validatedMessage: DownloadTaskMessage;
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
      retryCount: approximateReceiveCount - 1,
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
        taskLogger.error(
          { error: result.error?.message, code: result.error?.code },
          'Task failed',
        );

        await this.dynamoDb.incrementTaskCount(jobId, 'failedTasks');

        // Check if max retries exceeded
        if (approximateReceiveCount >= 3) {
          this.logger.error(
            {
              messageId,
              taskId,
              jobId,
              receiveCount: approximateReceiveCount,
            },
            'Max retries exceeded for download task',
          );

          // Don't throw - delete the message
          return;
        }

        // Throw to retry
        throw new Error(result.error?.message || 'Task failed');
      }

      // Check job completion
      await this.taskDispatcher.checkJobCompletion(jobId);
    } catch (error) {
      taskLogger.error(
        { error: (error as Error).message },
        'Error processing overflow task',
      );

      // Check if max retries exceeded
      if (approximateReceiveCount >= 3) {
        this.logger.error(
          {
            messageId,
            taskId,
            jobId,
            receiveCount: approximateReceiveCount,
          },
          'Max retries exceeded for download task',
        );

        await this.dynamoDb.incrementTaskCount(jobId, 'failedTasks');
        await this.taskDispatcher.checkJobCompletion(jobId);

        // Don't throw - delete the message
        return;
      }

      // Re-throw to retry
      throw error;
    }
  }
}
