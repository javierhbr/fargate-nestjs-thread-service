import { validateEnv, EnvConfig } from './validation.schema';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  logLevel: string;
  aws: {
    region: string;
    endpoint?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
  };
  sqs: {
    exportJobsUrl: string;
    downloadTasksUrl: string;
    maxMessages: number;
    waitTimeSeconds: number;
    visibilityTimeout: number;
  };
  dynamodb: {
    tableName: string;
  };
  s3: {
    bucketName: string;
    prefix: string;
  };
  exportApi: {
    baseUrl: string;
    timeout: number;
    maxRetries: number;
  };
  workerPool: {
    poolSize: number;
    maxConcurrentJobs: number;
    tempDir: string;
    maxFileSizeMb: number;
  };
  orchestrator: {
    pollingIntervalMs: number;
    maxPollingAttempts: number;
    dispatchBatchSize: number;
  };
}

export default (): AppConfig => {
  const env: EnvConfig = validateEnv(process.env);

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    aws: {
      region: env.AWS_REGION,
      endpoint: env.AWS_ENDPOINT,
    },
    sqs: {
      exportJobsUrl: env.SQS_EXPORT_JOBS_URL,
      downloadTasksUrl: env.SQS_DOWNLOAD_TASKS_URL,
      maxMessages: env.SQS_MAX_MESSAGES,
      waitTimeSeconds: env.SQS_WAIT_TIME_SECONDS,
      visibilityTimeout: env.SQS_VISIBILITY_TIMEOUT,
    },
    dynamodb: {
      tableName: env.DYNAMODB_TABLE_NAME,
    },
    s3: {
      bucketName: env.S3_BUCKET_NAME,
      prefix: env.S3_PREFIX,
    },
    exportApi: {
      baseUrl: env.EXPORT_API_BASE_URL,
      timeout: env.EXPORT_API_TIMEOUT,
      maxRetries: env.EXPORT_API_MAX_RETRIES,
    },
    workerPool: {
      poolSize: env.WORKER_POOL_SIZE,
      maxConcurrentJobs: env.MAX_CONCURRENT_JOBS,
      tempDir: env.TEMP_DIR,
      maxFileSizeMb: env.MAX_FILE_SIZE_MB,
    },
    orchestrator: {
      pollingIntervalMs: env.POLLING_INTERVAL_MS,
      maxPollingAttempts: env.MAX_POLLING_ATTEMPTS,
      dispatchBatchSize: env.DISPATCH_BATCH_SIZE,
    },
  };

  // Add AWS credentials only if explicitly provided
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    config.aws.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    };
  }

  return config;
};
