import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { PoolManagerService } from './pool-manager.service';

@Module({
  imports: [ConfigModule],
  providers: [PoolManagerService],
  exports: [PoolManagerService],
})
export class WorkerPoolModule {}
