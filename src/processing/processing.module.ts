import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { WorkerPoolModule } from '../worker-pool/worker-pool.module';
import { ExportApiService } from './services/export-api.service';
import { TaskDispatcherService } from './services/task-dispatcher.service';
import { PollingService } from './services/polling.service';
import { ExportJobConsumer } from './consumers/export-job.consumer';
import { OverflowConsumer } from './consumers/overflow.consumer';

@Module({
  imports: [SharedModule, WorkerPoolModule],
  providers: [
    ExportApiService,
    TaskDispatcherService,
    PollingService,
    ExportJobConsumer,
    OverflowConsumer,
  ],
  exports: [ExportApiService, TaskDispatcherService, PollingService],
})
export class ProcessingModule {}
