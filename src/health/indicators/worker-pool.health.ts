import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PoolManagerService } from '../../worker-pool/pool-manager.service';

@Injectable()
export class WorkerPoolHealthIndicator extends HealthIndicator {
  constructor(private readonly poolManager: PoolManagerService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const stats = this.poolManager.getStats();

    const details = {
      poolSize: stats.poolSize,
      activeWorkers: stats.activeWorkers,
      idleWorkers: stats.idleWorkers,
      queuedTasks: stats.queuedTasks,
      completedTasks: stats.completedTasks,
      failedTasks: stats.failedTasks,
      averageProcessingTimeMs: Math.round(stats.averageProcessingTimeMs),
    };

    if (stats.isHealthy) {
      return this.getStatus(key, true, details);
    }

    throw new HealthCheckError(
      'Worker pool is unhealthy - insufficient workers running',
      this.getStatus(key, false, details),
    );
  }
}
