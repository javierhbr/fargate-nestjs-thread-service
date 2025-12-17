import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import { AppConfig } from '../config/configuration';
import { PinoLoggerService } from '../shared/logging/pino-logger.service';
import { DownloadTask } from '../shared/interfaces/download-task.interface';
import {
  WorkerMessage,
  WorkerMessageType,
  ProcessTaskPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  WorkerConfig,
  HealthResponsePayload,
} from './interfaces/worker-message.interface';
import { PoolStats, WorkerStats } from './interfaces/pool-stats.interface';
import { ProcessingResult } from '../shared/interfaces/processing-result.interface';

interface WorkerWrapper {
  worker: Worker;
  workerId: number;
  isActive: boolean;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  lastActivityAt: Date;
}

interface QueuedTask {
  task: DownloadTask;
  resolve: (result: ProcessingResult) => void;
  reject: (error: Error) => void;
  queuedAt: Date;
}

@Injectable()
export class PoolManagerService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  private workers: Map<number, WorkerWrapper> = new Map();
  private taskQueue: QueuedTask[] = [];
  private pendingTasks: Map<string, QueuedTask> = new Map();
  private isShuttingDown = false;

  private readonly poolSize: number;
  private readonly maxConcurrentJobs: number;
  private readonly workerConfig: WorkerConfig;

  private completedTasksCount = 0;
  private failedTasksCount = 0;
  private totalProcessingTimeMs = 0;

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    super();

    const workerPoolConfig = this.configService.get('workerPool', { infer: true })!;
    const s3Config = this.configService.get('s3', { infer: true })!;
    const awsConfig = this.configService.get('aws', { infer: true })!;

    this.poolSize = workerPoolConfig.poolSize;
    this.maxConcurrentJobs = workerPoolConfig.maxConcurrentJobs;

    this.workerConfig = {
      tempDir: workerPoolConfig.tempDir,
      maxFileSizeMb: workerPoolConfig.maxFileSizeMb,
      s3BucketName: s3Config.bucketName,
      s3Prefix: s3Config.prefix,
      awsRegion: awsConfig.region,
    };

    this.logger.setContext(PoolManagerService.name);
  }

  async onModuleInit(): Promise<void> {
    await this.initializePool();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  private async initializePool(): Promise<void> {
    this.logger.info({ poolSize: this.poolSize }, 'Initializing worker pool');

    const workerPath = path.join(__dirname, 'threads', 'worker-thread.js');

    for (let i = 0; i < this.poolSize; i++) {
      await this.createWorker(i, workerPath);
    }

    this.logger.info(
      { poolSize: this.poolSize, activeWorkers: this.workers.size },
      'Worker pool initialized',
    );
  }

  private async createWorker(workerId: number, workerPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: { workerId },
      });

      const wrapper: WorkerWrapper = {
        worker,
        workerId,
        isActive: false,
        tasksCompleted: 0,
        tasksFailed: 0,
        lastActivityAt: new Date(),
      };

      worker.on('message', (message: WorkerMessage) => {
        this.handleWorkerMessage(workerId, message);
      });

      worker.on('error', (error) => {
        this.logger.error({ workerId, error: error.message }, 'Worker error');
        this.handleWorkerFailure(workerId);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && !this.isShuttingDown) {
          this.logger.warn({ workerId, code }, 'Worker exited unexpectedly');
          this.handleWorkerFailure(workerId);
        }
      });

      worker.on('online', () => {
        this.workers.set(workerId, wrapper);
        this.logger.debug({ workerId }, 'Worker online');
        resolve();
      });

      setTimeout(() => {
        if (!this.workers.has(workerId)) {
          reject(new Error(`Worker ${workerId} failed to start`));
        }
      }, 5000);
    });
  }

  private handleWorkerMessage(workerId: number, message: WorkerMessage): void {
    const wrapper = this.workers.get(workerId);
    if (!wrapper) return;

    wrapper.lastActivityAt = new Date();

    switch (message.type) {
      case WorkerMessageType.TASK_COMPLETED:
        this.handleTaskCompleted(workerId, message.payload as TaskCompletedPayload);
        break;

      case WorkerMessageType.TASK_FAILED:
        this.handleTaskFailed(workerId, message.payload as TaskFailedPayload);
        break;

      case WorkerMessageType.HEALTH_RESPONSE:
        this.emit('health', { ...(message.payload as HealthResponsePayload), workerId });
        break;
    }
  }

  private handleTaskCompleted(workerId: number, payload: TaskCompletedPayload): void {
    const wrapper = this.workers.get(workerId);
    if (wrapper) {
      wrapper.isActive = false;
      wrapper.currentTaskId = undefined;
      wrapper.tasksCompleted++;
    }

    this.completedTasksCount++;
    this.totalProcessingTimeMs += payload.processingTimeMs;

    const pending = this.pendingTasks.get(payload.taskId);
    if (pending) {
      this.pendingTasks.delete(payload.taskId);
      pending.resolve({
        taskId: payload.taskId,
        jobId: payload.jobId,
        success: true,
        outputKey: payload.outputKey,
        outputSize: payload.outputSize,
        processingTimeMs: payload.processingTimeMs,
      });
    }

    this.emit('taskCompleted', payload);
    this.processNextInQueue();
  }

  private handleTaskFailed(workerId: number, payload: TaskFailedPayload): void {
    const wrapper = this.workers.get(workerId);
    if (wrapper) {
      wrapper.isActive = false;
      wrapper.currentTaskId = undefined;
      wrapper.tasksFailed++;
    }

    this.failedTasksCount++;
    this.totalProcessingTimeMs += payload.processingTimeMs;

    const pending = this.pendingTasks.get(payload.taskId);
    if (pending) {
      this.pendingTasks.delete(payload.taskId);
      pending.resolve({
        taskId: payload.taskId,
        jobId: payload.jobId,
        success: false,
        error: payload.error,
        processingTimeMs: payload.processingTimeMs,
      });
    }

    this.emit('taskFailed', payload);
    this.processNextInQueue();
  }

  private handleWorkerFailure(workerId: number): void {
    const wrapper = this.workers.get(workerId);

    // Fail any pending task
    if (wrapper?.currentTaskId) {
      const pending = this.pendingTasks.get(wrapper.currentTaskId);
      if (pending) {
        this.pendingTasks.delete(wrapper.currentTaskId);
        pending.reject(new Error(`Worker ${workerId} crashed`));
      }
    }

    this.workers.delete(workerId);

    // Restart worker if not shutting down
    if (!this.isShuttingDown) {
      this.logger.info({ workerId }, 'Restarting failed worker');
      const workerPath = path.join(__dirname, 'threads', 'worker-thread.js');
      this.createWorker(workerId, workerPath).catch((error) => {
        this.logger.error({ workerId, error: error.message }, 'Failed to restart worker');
      });
    }
  }

  async submitTask(task: DownloadTask): Promise<ProcessingResult> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask = {
        task,
        resolve,
        reject,
        queuedAt: new Date(),
      };

      // Try to dispatch immediately
      const idleWorker = this.getIdleWorker();
      if (idleWorker) {
        this.dispatchToWorker(idleWorker, queuedTask);
      } else {
        // Queue if no idle workers
        this.taskQueue.push(queuedTask);
        this.logger.debug(
          { taskId: task.taskId, queueLength: this.taskQueue.length },
          'Task queued',
        );
      }
    });
  }

  private getIdleWorker(): WorkerWrapper | null {
    for (const wrapper of this.workers.values()) {
      if (!wrapper.isActive) {
        return wrapper;
      }
    }
    return null;
  }

  private dispatchToWorker(wrapper: WorkerWrapper, queuedTask: QueuedTask): void {
    wrapper.isActive = true;
    wrapper.currentTaskId = queuedTask.task.taskId;
    wrapper.lastActivityAt = new Date();

    this.pendingTasks.set(queuedTask.task.taskId, queuedTask);

    const message: WorkerMessage<ProcessTaskPayload> = {
      type: WorkerMessageType.PROCESS_TASK,
      payload: {
        task: queuedTask.task,
        config: this.workerConfig,
      },
      timestamp: Date.now(),
    };

    wrapper.worker.postMessage(message);

    this.logger.debug(
      { taskId: queuedTask.task.taskId, workerId: wrapper.workerId },
      'Task dispatched to worker',
    );
  }

  private processNextInQueue(): void {
    if (this.taskQueue.length === 0) return;

    const idleWorker = this.getIdleWorker();
    if (!idleWorker) return;

    const queuedTask = this.taskQueue.shift()!;
    this.dispatchToWorker(idleWorker, queuedTask);
  }

  hasCapacity(): boolean {
    const activeCount = this.getActiveWorkerCount();
    return activeCount < this.poolSize || this.taskQueue.length < this.maxConcurrentJobs;
  }

  canAcceptTask(): boolean {
    // Can accept if there's an idle worker or queue has space
    return (
      this.getIdleWorkerCount() > 0 ||
      this.taskQueue.length < this.maxConcurrentJobs - this.poolSize
    );
  }

  getIdleWorkerCount(): number {
    let count = 0;
    for (const wrapper of this.workers.values()) {
      if (!wrapper.isActive) count++;
    }
    return count;
  }

  getActiveWorkerCount(): number {
    return this.poolSize - this.getIdleWorkerCount();
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  getStats(): PoolStats {
    const activeWorkers = this.getActiveWorkerCount();
    const idleWorkers = this.getIdleWorkerCount();
    const totalCompleted = this.completedTasksCount + this.failedTasksCount;

    return {
      poolSize: this.poolSize,
      activeWorkers,
      idleWorkers,
      queuedTasks: this.taskQueue.length,
      completedTasks: this.completedTasksCount,
      failedTasks: this.failedTasksCount,
      averageProcessingTimeMs:
        totalCompleted > 0 ? this.totalProcessingTimeMs / totalCompleted : 0,
      isHealthy: this.workers.size >= Math.ceil(this.poolSize / 2),
    };
  }

  getWorkerStats(): WorkerStats[] {
    return Array.from(this.workers.values()).map((wrapper) => ({
      workerId: wrapper.workerId,
      isActive: wrapper.isActive,
      currentTaskId: wrapper.currentTaskId,
      tasksCompleted: wrapper.tasksCompleted,
      tasksFailed: wrapper.tasksFailed,
      lastActivityAt: wrapper.lastActivityAt,
    }));
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.logger.info('Shutting down worker pool');

    // Reject all queued tasks
    for (const queued of this.taskQueue) {
      queued.reject(new Error('Pool is shutting down'));
    }
    this.taskQueue = [];

    // Send shutdown to all workers
    const shutdownPromises = Array.from(this.workers.values()).map(async (wrapper) => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          wrapper.worker.terminate();
          resolve();
        }, 5000);

        wrapper.worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });

        const message: WorkerMessage = {
          type: WorkerMessageType.SHUTDOWN,
          payload: null,
          timestamp: Date.now(),
        };
        wrapper.worker.postMessage(message);
      });
    });

    await Promise.all(shutdownPromises);
    this.workers.clear();
    this.logger.info('Worker pool shut down');
  }
}
