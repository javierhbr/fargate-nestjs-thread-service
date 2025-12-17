import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { AppConfig } from '../../config/configuration';
import { SqsService } from '../../shared/aws/sqs/sqs.service';
import { DynamoDbService } from '../../shared/aws/dynamodb/dynamodb.service';
import { PinoLoggerService } from '../../shared/logging/pino-logger.service';
import { PoolManagerService } from '../../worker-pool/pool-manager.service';
import {
  DownloadTask,
  DownloadTaskMessage,
} from '../../shared/interfaces/download-task.interface';
import { ProcessingResult } from '../../shared/interfaces/processing-result.interface';
import { DownloadUrlInfo } from '../interfaces/export-api-response.interface';
import {
  DispatchResult,
  BatchDispatchResult,
} from '../interfaces/dispatch-options.interface';

@Injectable()
export class TaskDispatcherService {
  private readonly downloadTasksQueueUrl: string;
  private readonly dispatchBatchSize: number;

  constructor(
    private readonly poolManager: PoolManagerService,
    private readonly sqsService: SqsService,
    private readonly dynamoDb: DynamoDbService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const sqsConfig = this.configService.get('sqs', { infer: true })!;
    const orchestratorConfig = this.configService.get('orchestrator', { infer: true })!;

    this.downloadTasksQueueUrl = sqsConfig.downloadTasksUrl;
    this.dispatchBatchSize = orchestratorConfig.dispatchBatchSize;

    this.logger.setContext(TaskDispatcherService.name);
  }

  async dispatchDownloadTasks(
    jobId: string,
    exportId: string,
    downloadUrls: DownloadUrlInfo[],
  ): Promise<BatchDispatchResult> {
    this.logger.info(
      { jobId, exportId, urlCount: downloadUrls.length },
      'Dispatching download tasks',
    );

    // Update total tasks in state
    await this.dynamoDb.setTotalTasks(jobId, downloadUrls.length);

    const results: DispatchResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < downloadUrls.length; i += this.dispatchBatchSize) {
      const batch = downloadUrls.slice(i, i + this.dispatchBatchSize);

      const batchResults = await Promise.all(
        batch.map((urlInfo, index) =>
          this.dispatchSingleTask(jobId, exportId, urlInfo, i + index),
        ),
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.dispatched) {
          successful++;
        } else {
          failed++;
        }
      }
    }

    this.logger.info(
      { jobId, total: downloadUrls.length, successful, failed },
      'Download tasks dispatched',
    );

    return {
      total: downloadUrls.length,
      successful,
      failed,
      results,
    };
  }

  private async dispatchSingleTask(
    jobId: string,
    exportId: string,
    urlInfo: DownloadUrlInfo,
    index: number,
  ): Promise<DispatchResult> {
    const taskId = uuidv4();
    const outputKey = `${jobId}/${index}_${urlInfo.fileName}`;

    const task: DownloadTask = {
      taskId,
      jobId,
      exportId,
      downloadUrl: urlInfo.url,
      fileName: urlInfo.fileName,
      fileSize: urlInfo.fileSize,
      checksum: urlInfo.checksum,
      outputKey,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
    };

    try {
      // Check if pool can accept the task
      if (this.poolManager.canAcceptTask()) {
        // Dispatch to internal pool - fire and forget, results handled via events
        this.dispatchToInternalPool(task);

        return {
          taskId,
          dispatched: true,
          destination: 'internal',
        };
      } else {
        // Overflow to SQS
        await this.dispatchToOverflowQueue(task);

        return {
          taskId,
          dispatched: true,
          destination: 'overflow',
        };
      }
    } catch (error) {
      this.logger.error(
        { taskId, jobId, error: (error as Error).message },
        'Failed to dispatch task',
      );

      return {
        taskId,
        dispatched: false,
        destination: 'internal',
        error: (error as Error).message,
      };
    }
  }

  private dispatchToInternalPool(task: DownloadTask): void {
    this.logger.debug(
      { taskId: task.taskId, jobId: task.jobId },
      'Dispatching to internal pool',
    );

    // Submit task and handle result asynchronously
    this.poolManager
      .submitTask(task)
      .then((result) => this.handleTaskResult(result))
      .catch((error) => {
        this.logger.error(
          { taskId: task.taskId, error: error.message },
          'Internal pool task failed',
        );
        // Update state for failed task
        this.dynamoDb.incrementTaskCount(task.jobId, 'failedTasks');
      });
  }

  private async dispatchToOverflowQueue(task: DownloadTask): Promise<void> {
    this.logger.debug(
      { taskId: task.taskId, jobId: task.jobId },
      'Dispatching to overflow queue',
    );

    const message: DownloadTaskMessage = {
      taskId: task.taskId,
      jobId: task.jobId,
      exportId: task.exportId,
      downloadUrl: task.downloadUrl,
      fileName: task.fileName,
      fileSize: task.fileSize,
      checksum: task.checksum,
      outputKey: task.outputKey,
      metadata: task.metadata,
    };

    await this.sqsService.sendMessage(this.downloadTasksQueueUrl, message);
  }

  private async handleTaskResult(result: ProcessingResult): Promise<void> {
    this.logger.info(
      {
        taskId: result.taskId,
        jobId: result.jobId,
        success: result.success,
        outputKey: result.outputKey,
      },
      'Task completed',
    );

    if (result.success) {
      await this.dynamoDb.incrementTaskCount(result.jobId, 'completedTasks');
    } else {
      await this.dynamoDb.incrementTaskCount(result.jobId, 'failedTasks');
    }

    // Check if job is complete
    await this.checkJobCompletion(result.jobId);
  }

  async checkJobCompletion(jobId: string): Promise<boolean> {
    const state = await this.dynamoDb.getJobState(jobId);
    if (!state) return false;

    const processedTasks = state.completedTasks + state.failedTasks;
    if (processedTasks >= state.totalTasks && state.totalTasks > 0) {
      const finalStatus = state.failedTasks === 0 ? 'COMPLETED' : 'COMPLETED';

      await this.dynamoDb.updateJobStatus(jobId, finalStatus as never, {
        completedTasks: state.completedTasks,
        failedTasks: state.failedTasks,
      });

      this.logger.info(
        {
          jobId,
          completedTasks: state.completedTasks,
          failedTasks: state.failedTasks,
          status: finalStatus,
        },
        'Job completed',
      );

      return true;
    }

    return false;
  }

  getPoolStats() {
    return this.poolManager.getStats();
  }
}
