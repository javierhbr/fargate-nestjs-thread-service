import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SqsHealthIndicator } from './indicators/sqs.health';
import { DynamoDbHealthIndicator } from './indicators/dynamodb.health';
import { WorkerPoolHealthIndicator } from './indicators/worker-pool.health';
import { DiskSpaceHealthIndicator } from './indicators/disk-space.health';
import { SharedModule } from '../shared/shared.module';
import { WorkerPoolModule } from '../worker-pool/worker-pool.module';

@Module({
  imports: [TerminusModule, SharedModule, WorkerPoolModule],
  controllers: [HealthController],
  providers: [
    SqsHealthIndicator,
    DynamoDbHealthIndicator,
    WorkerPoolHealthIndicator,
    DiskSpaceHealthIndicator,
  ],
})
export class HealthModule {}
