import { Module } from '@nestjs/common';
import { ConfigModule } from '../../../config/config.module';
import { DynamoDbService } from './dynamodb.service';

@Module({
  imports: [ConfigModule],
  providers: [DynamoDbService],
  exports: [DynamoDbService],
})
export class DynamoDbModule {}
