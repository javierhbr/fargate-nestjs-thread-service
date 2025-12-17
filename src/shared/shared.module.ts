import { Module } from '@nestjs/common';
import { AwsModule } from './aws/aws.module';
import { HttpModule } from './http/http.module';
import { LoggingModule } from './logging/logging.module';

@Module({
  imports: [AwsModule, HttpModule, LoggingModule],
  exports: [AwsModule, HttpModule, LoggingModule],
})
export class SharedModule {}
