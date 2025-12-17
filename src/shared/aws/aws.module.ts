import { Module } from '@nestjs/common';
import { SqsModule } from './sqs/sqs.module';
import { S3Module } from './s3/s3.module';
import { DynamoDbModule } from './dynamodb/dynamodb.module';

@Module({
  imports: [SqsModule, S3Module, DynamoDbModule],
  exports: [SqsModule, S3Module, DynamoDbModule],
})
export class AwsModule {}
