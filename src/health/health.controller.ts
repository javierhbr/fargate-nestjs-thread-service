import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SqsHealthIndicator } from './indicators/sqs.health';
import { DynamoDbHealthIndicator } from './indicators/dynamodb.health';
import { WorkerPoolHealthIndicator } from './indicators/worker-pool.health';
import { DiskSpaceHealthIndicator } from './indicators/disk-space.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly sqsHealth: SqsHealthIndicator,
    private readonly dynamoDbHealth: DynamoDbHealthIndicator,
    private readonly workerPoolHealth: WorkerPoolHealthIndicator,
    private readonly diskSpaceHealth: DiskSpaceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024), // 500MB
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024), // 1GB
      () => this.workerPoolHealth.isHealthy('worker_pool'),
      () => this.diskSpaceHealth.isHealthy('disk_space'),
    ]);
  }

  @Get('live')
  @HealthCheck()
  liveness() {
    // Simple liveness check - just verify the service is running
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
    ]);
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    // Readiness check - verify all dependencies are available
    return this.health.check([
      () => this.sqsHealth.isHealthy('sqs'),
      () => this.dynamoDbHealth.isHealthy('dynamodb'),
      () => this.workerPoolHealth.isHealthy('worker_pool'),
      () => this.diskSpaceHealth.isHealthy('disk_space'),
    ]);
  }

  @Get('detailed')
  @HealthCheck()
  detailed() {
    // Detailed health check with all indicators
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 500 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 1024 * 1024 * 1024),
      () => this.sqsHealth.isHealthy('sqs'),
      () => this.dynamoDbHealth.isHealthy('dynamodb'),
      () => this.workerPoolHealth.isHealthy('worker_pool'),
      () => this.diskSpaceHealth.isHealthy('disk_space'),
    ]);
  }
}
