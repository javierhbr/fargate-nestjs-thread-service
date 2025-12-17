import { Module } from '@nestjs/common';
import { PoolManagerService } from './pool-manager.service';

@Module({
  providers: [PoolManagerService],
  exports: [PoolManagerService],
})
export class WorkerPoolModule {}
