import { Injectable } from '@nestjs/common';
import {
  WorkerPoolPort,
  WorkerPoolStats,
} from '../../src/application/ports/output/worker-pool.port';
import { DownloadTaskEntity } from '../../src/domain/entities/download-task.entity';

/**
 * In-Memory Worker Pool Adapter
 * For ATDD testing - simulates worker pool without actual threads
 */
@Injectable()
export class InMemoryWorkerPoolAdapter implements WorkerPoolPort {
  private maxWorkers: number = 10;
  private activeWorkers: number = 0;
  private queuedTasks: DownloadTaskEntity[] = [];
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private totalProcessingTimeMs: number = 0;

  // Test configuration
  private taskProcessingDelay: number = 0; // Simulate processing delay
  private simulateFailure: boolean = false;
  private failureRate: number = 0; // 0.0 to 1.0

  async submitTask(task: DownloadTaskEntity): Promise<void> {
    if (this.hasCapacity()) {
      await this.processTask(task);
    } else {
      this.queuedTasks.push(task);
    }
  }

  async submitTasks(tasks: DownloadTaskEntity[]): Promise<void> {
    for (const task of tasks) {
      await this.submitTask(task);
    }
  }

  hasCapacity(): boolean {
    return this.activeWorkers < this.maxWorkers;
  }

  getAvailableWorkerCount(): number {
    return Math.max(0, this.maxWorkers - this.activeWorkers);
  }

  getStats(): WorkerPoolStats {
    const avgProcessingTime =
      this.completedTasks + this.failedTasks > 0
        ? this.totalProcessingTimeMs / (this.completedTasks + this.failedTasks)
        : 0;

    return {
      totalWorkers: this.maxWorkers,
      activeWorkers: this.activeWorkers,
      idleWorkers: this.getAvailableWorkerCount(),
      queuedTasks: this.queuedTasks.length,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      averageProcessingTimeMs: avgProcessingTime,
    };
  }

  async waitForCompletion(): Promise<void> {
    // In tests, we process synchronously, so nothing to wait for
    while (this.queuedTasks.length > 0 && this.hasCapacity()) {
      const task = this.queuedTasks.shift()!;
      await this.processTask(task);
    }
  }

  async shutdown(): Promise<void> {
    this.queuedTasks = [];
    this.activeWorkers = 0;
  }

  // Test helper methods

  /**
   * Configure the maximum number of workers
   */
  setMaxWorkers(count: number): void {
    this.maxWorkers = count;
  }

  /**
   * Configure processing delay (in ms)
   */
  setProcessingDelay(delayMs: number): void {
    this.taskProcessingDelay = delayMs;
  }

  /**
   * Configure failure simulation
   */
  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Get queued tasks
   */
  getQueuedTasks(): DownloadTaskEntity[] {
    return [...this.queuedTasks];
  }

  /**
   * Get statistics for assertions
   */
  getCompletedTaskCount(): number {
    return this.completedTasks;
  }

  getFailedTaskCount(): number {
    return this.failedTasks;
  }

  /**
   * Reset adapter state
   */
  clear(): void {
    this.activeWorkers = 0;
    this.queuedTasks = [];
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.totalProcessingTimeMs = 0;
    this.taskProcessingDelay = 0;
    this.failureRate = 0;
    this.maxWorkers = 10;
  }

  private async processTask(_task: DownloadTaskEntity): Promise<void> {
    this.activeWorkers++;

    try {
      // Simulate processing delay
      if (this.taskProcessingDelay > 0) {
        await this.sleep(this.taskProcessingDelay);
      }

      const startTime = Date.now();

      // Simulate random failures based on failure rate
      const shouldFail = this.failureRate > 0 && Math.random() < this.failureRate;

      if (shouldFail) {
        this.failedTasks++;
      } else {
        this.completedTasks++;
      }

      const processingTime = Date.now() - startTime + this.taskProcessingDelay;
      this.totalProcessingTimeMs += processingTime;
    } finally {
      this.activeWorkers--;

      // Process next queued task if available
      if (this.queuedTasks.length > 0 && this.hasCapacity()) {
        const nextTask = this.queuedTasks.shift()!;
        // Fire and forget - don't await to simulate concurrent processing
        this.processTask(nextTask);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
