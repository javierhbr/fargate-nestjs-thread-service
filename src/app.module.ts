import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SqsModule } from '@ssut/nestjs-sqs';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AppConfig } from './config/configuration';
import { SharedModule } from './shared/shared.module';
import { WorkerPoolModule } from './worker-pool/worker-pool.module';
import { ProcessingModule } from './processing/processing.module';

/**
 * Application Module
 * SQS-based microservice for processing export jobs
 * Uses @ssut/nestjs-sqs for consuming messages
 */
@Module({
  imports: [
    ConfigModule,
    SharedModule,

    // Configure SQS Module for consuming and producing messages
    SqsModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig>) => {
        const awsConfig = configService.get('aws', { infer: true })!;
        const sqsConfig = configService.get('sqs', { infer: true })!;

        // Create SQS client with LocalStack support
        const sqsClient = new SQSClient({
          region: awsConfig.region,
          ...(awsConfig.endpoint && {
            endpoint: awsConfig.endpoint,
            credentials: awsConfig.credentials,
          }),
        });

        return {
          consumers: [
            {
              name: 'export-jobs-queue',
              queueUrl: sqsConfig.exportJobsUrl,
              region: awsConfig.region,
              sqs: sqsClient,
            },
            {
              name: 'download-tasks-queue',
              queueUrl: sqsConfig.downloadTasksUrl,
              region: awsConfig.region,
              sqs: sqsClient,
            },
          ],
          producers: [
            {
              name: 'export-jobs-producer',
              queueUrl: sqsConfig.exportJobsUrl,
              region: awsConfig.region,
              sqs: sqsClient,
            },
            {
              name: 'download-tasks-producer',
              queueUrl: sqsConfig.downloadTasksUrl,
              region: awsConfig.region,
              sqs: sqsClient,
            },
          ],
        };
      },
    }),

    WorkerPoolModule,
    ProcessingModule,
  ],
})
export class AppModule {}
