export interface PoolStats {
  poolSize: number;
  activeWorkers: number;
  idleWorkers: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageProcessingTimeMs: number;
  isHealthy: boolean;
}

export interface WorkerStats {
  workerId: number;
  isActive: boolean;
  currentTaskId?: string;
  tasksCompleted: number;
  tasksFailed: number;
  lastActivityAt: Date;
  memoryUsage?: NodeJS.MemoryUsage;
}
