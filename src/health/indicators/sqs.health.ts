import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { AppConfig } from '../../config/configuration';
import { SqsService } from '../../shared/aws/sqs/sqs.service';

@Injectable()
export class SqsHealthIndicator extends HealthIndicator {
  constructor(
    private readonly sqsService: SqsService,
    private readonly configService: ConfigService<AppConfig>,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const sqsConfig = this.configService.get('sqs', { infer: true })!;

    try {
      // Check export jobs queue
      const exportJobsAttrs = await this.sqsService.getQueueAttributes(
        sqsConfig.exportJobsUrl,
      );

      // Check download tasks queue
      const downloadTasksAttrs = await this.sqsService.getQueueAttributes(
        sqsConfig.downloadTasksUrl,
      );

      const details = {
        exportJobsQueue: {
          approximateMessages: exportJobsAttrs.approximateMessages,
          messagesInFlight: exportJobsAttrs.approximateMessagesNotVisible,
        },
        downloadTasksQueue: {
          approximateMessages: downloadTasksAttrs.approximateMessages,
          messagesInFlight: downloadTasksAttrs.approximateMessagesNotVisible,
        },
      };

      return this.getStatus(key, true, details);
    } catch (error) {
      throw new HealthCheckError(
        'SQS health check failed',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }
}
