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

/**
 * Wrapper interface for Node.js Worker Thread instances.
 *
 * Each worker is tracked with metadata to manage its lifecycle and monitor performance:
 * - worker: The actual Worker instance from Node.js worker_threads module
 * - workerId: Unique identifier for logging and tracking (0-based index)
 * - isActive: Whether the worker is currently processing a task
 * - currentTaskId: Optional ID of the task being processed (for debugging)
 * - tasksCompleted: Counter for successfully completed tasks (monotonically increasing)
 * - tasksFailed: Counter for failed tasks (monotonically increasing)
 * - lastActivityAt: Timestamp of last task assignment (for health monitoring)
 */
interface WorkerWrapper {
  worker: Worker;
  workerId: number;
  isActive: boolean;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  lastActivityAt: Date;
}

/**
 * Queued task with Promise resolution handlers.
 *
 * Tasks are queued when all workers are busy. Each queued task includes:
 * - task: The download task to be processed
 * - resolve: Promise resolver called with ProcessingResult on success
 * - reject: Promise rejector called with Error on failure
 * - queuedAt: Timestamp when task was queued (for queue time metrics)
 */
interface QueuedTask {
  task: DownloadTask;
  resolve: (result: ProcessingResult) => void;
  reject: (error: Error) => void;
  queuedAt: Date;
}

/**
 * Worker Pool Manager Service
 *
 * Manages a pool of Node.js Worker Threads for parallel file download and processing.
 *
 * ## Architecture Overview:
 *
 * This service implements a thread pool pattern using Node.js worker_threads to process
 * file downloads in parallel without blocking the main event loop. Each worker runs in
 * an isolated V8 context with its own memory space.
 *
 * ## Key Responsibilities:
 *
 * 1. **Worker Lifecycle Management**
 *    - Creates and initializes worker threads on module startup
 *    - Monitors worker health and handles errors/exits
 *    - Gracefully shuts down workers on module destruction
 *
 * 2. **Task Distribution**
 *    - Queues tasks when all workers are busy
 *    - Distributes tasks to available (idle) workers
 *    - Tracks pending tasks and provides status updates
 *
 * 3. **Load Balancing**
 *    - Round-robin task assignment to workers
 *    - Prevents overloading by enforcing maxConcurrentJobs limit
 *    - Queues excess tasks for later processing
 *
 * 4. **Communication**
 *    - Uses message passing for worker communication (postMessage)
 *    - Handles worker responses via message listeners
 *    - Emits events for external monitoring (health, task completion)
 *
 * 5. **Metrics & Monitoring**
 *    - Tracks completed/failed task counts
 *    - Calculates average processing time
 *    - Provides pool statistics via getPoolStats()
 *
 * ## Thread Safety:
 *
 * Workers operate in isolation with no shared memory. All communication happens via:
 * - Structured cloning of messages (postMessage)
 * - Message event listeners on both main thread and workers
 * - No direct memory access between threads
 *
 * ## Configuration:
 *
 * Pool behavior is configured via environment variables:
 * - WORKER_POOL_SIZE: Number of worker threads (default: 4)
 * - MAX_CONCURRENT_JOBS: Max tasks in flight + queued (default: 20)
 * - TEMP_DIR: Temporary directory for downloads
 * - MAX_FILE_SIZE_MB: Maximum file size limit
 *
 * ## Performance Considerations:
 *
 * - Workers are CPU-bound for large files (compression, validation)
 * - Pool size should match available CPU cores (typically 2-8)
 * - Each worker has memory overhead (~10-50MB per worker)
 * - Queue prevents memory exhaustion under high load
 *
 * ## Error Handling:
 *
 * - Worker crashes trigger automatic recreation
 * - Task errors are isolated to individual workers
 * - Failed tasks can be retried via SQS visibility timeout
 * - Graceful shutdown waits for in-flight tasks to complete
 */
@Injectable()
export class PoolManagerService
  extends EventEmitter
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * Map of all worker threads indexed by workerId.
   * Used for O(1) lookup when routing messages from workers.
   */
  private workers: Map<number, WorkerWrapper> = new Map();

  /**
   * FIFO queue of tasks waiting for an available worker.
   * Tasks are added when all workers are busy and processed in order.
   */
  private taskQueue: QueuedTask[] = [];

  /**
   * Map of tasks currently being processed, indexed by taskId.
   * Used to track in-flight tasks and route completion/failure messages.
   */
  private pendingTasks: Map<string, QueuedTask> = new Map();

  /**
   * Flag indicating graceful shutdown is in progress.
   * When true, new tasks are rejected and workers complete current tasks.
   */
  private isShuttingDown = false;

  /**
   * Number of worker threads in the pool (immutable after initialization).
   * Configured via WORKER_POOL_SIZE environment variable.
   */
  private readonly poolSize: number;

  /**
   * Maximum number of concurrent jobs (in-flight + queued).
   * Configured via MAX_CONCURRENT_JOBS environment variable.
   * Prevents memory exhaustion under high load.
   */
  private readonly maxConcurrentJobs: number;

  /**
   * Configuration passed to each worker thread.
   * Includes AWS credentials, temp directory, and file size limits.
   */
  private readonly workerConfig: WorkerConfig;

  /**
   * Cumulative count of successfully completed tasks across all workers.
   * Used for calculating pool statistics and monitoring.
   */
  private completedTasksCount = 0;

  /**
   * Cumulative count of failed tasks across all workers.
   * Used for error rate monitoring and alerting.
   */
  private failedTasksCount = 0;

  /**
   * Sum of processing times for all completed tasks (in milliseconds).
   * Used to calculate average processing time per task.
   */
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

  /**
   * Submit a download task to the worker pool.
   *
   * This is the main entry point for external consumers to request file processing.
   *
   * ## Flow:
   * 1. Check if pool is shutting down (reject if true)
   * 2. Wrap task in QueuedTask with Promise handlers
   * 3. Try to find an idle worker
   * 4. If worker available: dispatch immediately
   * 5. If all busy: add to queue for later processing
   *
   * ## Thread Safety:
   * This method runs on the main thread and synchronously modifies pool state.
   * Worker communication is async via message passing.
   *
   * ## Backpressure:
   * Callers should check hasCapacity() before submitting to avoid queue buildup.
   * The queue is unbounded, so excessive submissions can cause memory issues.
   *
   * @param task - The download task to process (includes URL, format, output location)
   * @returns Promise that resolves with ProcessingResult when task completes
   * @throws Error if pool is shutting down
   */
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

  /**
   * Find an idle (not currently processing) worker.
   *
   * ## Algorithm:
   * Linear search through workers map (O(n) where n = pool size).
   * Returns first idle worker found (simple round-robin).
   *
   * ## Optimization Opportunity:
   * Could maintain a separate Set of idle workers for O(1) lookup,
   * but current approach is sufficient for small pool sizes (2-8 workers).
   *
   * @returns WorkerWrapper if idle worker found, null if all busy
   */
  private getIdleWorker(): WorkerWrapper | null {
    for (const wrapper of this.workers.values()) {
      if (!wrapper.isActive) {
        return wrapper;
      }
    }
    return null;
  }

  /**
   * Dispatch a queued task to a specific worker thread.
   *
   * ## Steps:
   * 1. Mark worker as active and update metadata
   * 2. Add task to pendingTasks map for tracking
   * 3. Construct message payload with task + config
   * 4. Send message to worker via postMessage (async, non-blocking)
   *
   * ## Message Passing:
   * Uses structured clone algorithm to serialize task data.
   * Large objects (>1MB) may impact performance - use references when possible.
   *
   * ## Worker Communication Protocol:
   * - Message type: PROCESS_TASK
   * - Payload: { task: DownloadTask, config: WorkerConfig }
   * - Response: TASK_COMPLETED or TASK_FAILED message
   *
   * @param wrapper - The worker to dispatch to (must be idle)
   * @param queuedTask - The task with Promise handlers
   */
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

  /**
   * Process the next queued task if a worker is available.
   *
   * ## When Called:
   * - After a worker completes a task (becomes idle)
   * - After a worker fails and is replaced
   *
   * ## Algorithm:
   * 1. Check if queue is empty (early return if true)
   * 2. Find an idle worker
   * 3. If found: dequeue task (FIFO) and dispatch
   * 4. If not found: task stays in queue
   *
   * ## Queue Ordering:
   * FIFO (First In, First Out) ensures fairness.
   * Tasks are processed in submission order.
   *
   * ## Starvation Prevention:
   * All queued tasks will eventually be processed as workers become available.
   * No priority system - all tasks treated equally.
   */
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
