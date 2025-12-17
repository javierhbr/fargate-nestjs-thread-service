import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { AppConfig } from '../../../config/configuration';
import { PinoLoggerService } from '../../logging/pino-logger.service';
import { ExportJobStatus } from '../../interfaces/export-job.interface';

export interface JobState {
  jobId: string;
  exportId: string;
  userId: string;
  status: ExportJobStatus;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: {
    code: string;
    message: string;
  };
  metadata?: Record<string, unknown>;
  ttl?: number;
}

@Injectable()
export class DynamoDbService implements OnModuleDestroy {
  private readonly client: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(
    private readonly configService: ConfigService<AppConfig>,
    private readonly logger: PinoLoggerService,
  ) {
    const awsConfig = this.configService.get('aws', { infer: true })!;
    const dynamoConfig = this.configService.get('dynamodb', { infer: true })!;

    this.client = new DynamoDBClient({
      region: awsConfig.region,
      ...(awsConfig.endpoint && { endpoint: awsConfig.endpoint }),
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });

    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });

    this.tableName = dynamoConfig.tableName;
    this.logger.setContext(DynamoDbService.name);
  }

  async createJobState(state: Omit<JobState, 'updatedAt'>): Promise<JobState> {
    const now = new Date().toISOString();
    const item: JobState = {
      ...state,
      updatedAt: now,
      ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days TTL
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(jobId)',
      }),
    );

    this.logger.info({ jobId: state.jobId }, 'Job state created');
    return item;
  }

  async getJobState(jobId: string): Promise<JobState | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { jobId },
      }),
    );

    return (result.Item as JobState) || null;
  }

  async updateJobStatus(
    jobId: string,
    status: ExportJobStatus,
    additionalUpdates?: Partial<JobState>,
  ): Promise<JobState | null> {
    const now = new Date().toISOString();

    let updateExpression = 'SET #status = :status, updatedAt = :updatedAt';
    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':status': status,
      ':updatedAt': now,
    };

    if (additionalUpdates) {
      Object.entries(additionalUpdates).forEach(([key, value]) => {
        if (value !== undefined && key !== 'jobId' && key !== 'status') {
          updateExpression += `, #${key} = :${key}`;
          expressionAttributeNames[`#${key}`] = key;
          expressionAttributeValues[`:${key}`] = value;
        }
      });
    }

    if (status === ExportJobStatus.COMPLETED || status === ExportJobStatus.FAILED) {
      updateExpression += ', completedAt = :completedAt';
      expressionAttributeValues[':completedAt'] = now;
    }

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { jobId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    this.logger.info({ jobId, status }, 'Job status updated');
    return result.Attributes as JobState;
  }

  async incrementTaskCount(
    jobId: string,
    field: 'completedTasks' | 'failedTasks',
  ): Promise<JobState | null> {
    const now = new Date().toISOString();

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { jobId },
        UpdateExpression: `SET #field = #field + :inc, updatedAt = :updatedAt`,
        ExpressionAttributeNames: {
          '#field': field,
        },
        ExpressionAttributeValues: {
          ':inc': 1,
          ':updatedAt': now,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    return result.Attributes as JobState;
  }

  async setTotalTasks(jobId: string, totalTasks: number): Promise<void> {
    const now = new Date().toISOString();

    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { jobId },
        UpdateExpression: 'SET totalTasks = :totalTasks, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':totalTasks': totalTasks,
          ':updatedAt': now,
        },
      }),
    );
  }

  async getJobsByStatus(status: ExportJobStatus, limit = 100): Promise<JobState[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
        },
        Limit: limit,
      }),
    );

    return (result.Items as JobState[]) || [];
  }

  async deleteJobState(jobId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { jobId },
      }),
    );

    this.logger.info({ jobId }, 'Job state deleted');
  }

  onModuleDestroy() {
    this.client.destroy();
  }
}
