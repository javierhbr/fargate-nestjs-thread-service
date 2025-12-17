import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '../../logging/logging.module';
import { StepFunctionsService } from './step-functions.service';

@Module({
  imports: [ConfigModule, LoggingModule],
  providers: [StepFunctionsService],
  exports: [StepFunctionsService],
})
export class StepFunctionsModule {}
