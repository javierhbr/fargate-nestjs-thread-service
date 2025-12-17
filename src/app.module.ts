import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { SharedModule } from './shared/shared.module';
import { WorkerPoolModule } from './worker-pool/worker-pool.module';
import { ProcessingModule } from './processing/processing.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [ConfigModule, SharedModule, WorkerPoolModule, ProcessingModule, HealthModule],
})
export class AppModule {}
