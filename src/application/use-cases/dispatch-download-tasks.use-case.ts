import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  DispatchDownloadTasksCommand,
  DispatchDownloadTasksPort,
  DispatchDownloadTasksResult,
  TaskDispatchInfo,
} from '../ports/input/dispatch-download-tasks.port';
import { JobStateRepositoryPort } from '../ports/output/job-state-repository.port';
import { WorkerPoolPort } from '../ports/output/worker-pool.port';
import { MessageQueuePort } from '../ports/output/message-queue.port';
import { EventPublisherPort } from '../ports/output/event-publisher.port';
import { DownloadTaskEntity } from '../../domain/entities/download-task.entity';
import { FileMetadataVO } from '../../domain/value-objects/file-metadata.vo';
import { TaskDispatchedEvent } from '../../domain/events/task-dispatched.event';

/**
 * Dispatch Download Tasks Use Case
 * Handles creating and distributing download tasks to workers or overflow queue
 */
@Injectable()
export class DispatchDownloadTasksUseCase implements DispatchDownloadTasksPort {
  private readonly logger = new Logger(DispatchDownloadTasksUseCase.name);

  constructor(
    private readonly jobRepository: JobStateRepositoryPort,
    private readonly workerPool: WorkerPoolPort,
    private readonly messageQueue: MessageQueuePort,
    private readonly eventPublisher: EventPublisherPort,
    private readonly overflowQueueUrl: string,
    private readonly s3Bucket: string,
  ) {}

  async execute(command: DispatchDownloadTasksCommand): Promise<DispatchDownloadTasksResult> {
    this.logger.log(`Dispatching ${command.downloadUrls.length} download tasks for job: ${command.jobId}`);

    try {
      // Retrieve job
      const job = await this.jobRepository.findById(command.jobId);
      if (!job) {
        throw new Error(`Job ${command.jobId} not found`);
      }

      // Create download tasks
      const tasks: DownloadTaskEntity[] = command.downloadUrls.map((url, index) => {
        const taskId = uuidv4();
        const fileName = this.extractFileNameFromUrl(url, index);
        const s3OutputKey = `${command.jobId}/${fileName}`;

        const fileMetadata = FileMetadataVO.create({
          fileName,
          downloadUrl: url,
        });

        return DownloadTaskEntity.create({
          taskId,
          jobId: command.jobId,
          fileMetadata,
          s3OutputKey,
        });
      });

      // Update job with total tasks
      await this.jobRepository.setTotalTasks(command.jobId, tasks.length);

      // Dispatch tasks
      const dispatchedTasks: TaskDispatchInfo[] = [];
      let tasksToWorkerPool = 0;
      let tasksToOverflowQueue = 0;

      for (const task of tasks) {
        if (this.workerPool.hasCapacity()) {
          // Send to worker pool
          await this.workerPool.submitTask(task);
          dispatchedTasks.push({ task, dispatchedTo: 'worker-pool' });
          tasksToWorkerPool++;
        } else {
          // Send to overflow queue
          await this.messageQueue.sendMessage(this.overflowQueueUrl, {
            taskId: task.taskId,
            jobId: task.jobId,
            downloadUrl: task.fileMetadata.downloadUrl,
            fileName: task.fileMetadata.fileName,
            s3OutputKey: task.s3OutputKey,
            s3Bucket: this.s3Bucket,
          });
          dispatchedTasks.push({ task, dispatchedTo: 'overflow-queue' });
          tasksToOverflowQueue++;
        }

        // Publish task dispatched event
        const taskDispatchedEvent = new TaskDispatchedEvent({
          taskId: task.taskId,
          jobId: task.jobId,
          fileName: task.fileMetadata.fileName,
          downloadUrl: task.fileMetadata.downloadUrl,
          s3OutputKey: task.s3OutputKey,
          dispatchedTo: dispatchedTasks[dispatchedTasks.length - 1].dispatchedTo,
        });
        this.eventPublisher.publishAsync(taskDispatchedEvent);
      }

      this.logger.log(
        `Dispatched ${tasksToWorkerPool} tasks to worker pool, ${tasksToOverflowQueue} to overflow queue`,
      );

      return {
        jobId: command.jobId,
        totalTasksDispatched: tasks.length,
        tasksToWorkerPool,
        tasksToOverflowQueue,
        dispatchedTasks,
      };
    } catch (error) {
      this.logger.error(`Failed to dispatch download tasks for job ${command.jobId}:`, error);
      throw error;
    }
  }

  private extractFileNameFromUrl(url: string, index: number): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const parts = pathname.split('/');
      const fileName = parts[parts.length - 1];
      return fileName || `file-${index}.dat`;
    } catch {
      return `file-${index}.dat`;
    }
  }
}
