import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class DynamoDbHealthIndicator extends HealthIndicator {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;

  constructor(private readonly configService: ConfigService<AppConfig>) {
    super();

    const awsConfig = this.configService.get('aws', { infer: true })!;
    const dynamoConfig = this.configService.get('dynamodb', { infer: true })!;

    this.client = new DynamoDBClient({
      region: awsConfig.region,
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });

    this.tableName = dynamoConfig.tableName;
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const response = await this.client.send(
        new DescribeTableCommand({
          TableName: this.tableName,
        }),
      );

      const tableStatus = response.Table?.TableStatus;
      const isHealthy = tableStatus === 'ACTIVE';

      const details = {
        tableName: this.tableName,
        tableStatus,
        itemCount: response.Table?.ItemCount,
        tableSizeBytes: response.Table?.TableSizeBytes,
      };

      if (isHealthy) {
        return this.getStatus(key, true, details);
      }

      throw new HealthCheckError(
        `DynamoDB table is not active: ${tableStatus}`,
        this.getStatus(key, false, details),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      throw new HealthCheckError(
        'DynamoDB health check failed',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }
}
