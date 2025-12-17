/**
 * Application Configuration Module
 *
 * Central configuration management for the export processing service.
 * Loads and validates environment variables, providing type-safe access
 * to all configuration values throughout the application.
 *
 * ## Configuration Sources:
 * 1. Environment variables (`.env` file or system environment)
 * 2. Validated by Zod schema in `validation.schema.ts`
 * 3. Transformed into typed AppConfig object
 *
 * ## Usage:
 * ```typescript
 * // In NestJS service
 * constructor(private configService: ConfigService<AppConfig>) {}
 *
 * const poolSize = this.configService.get('workerPool.poolSize', { infer: true });
 * ```
 *
 * @module Configuration
 */

import { validateEnv, EnvConfig } from './validation.schema';

/**
 * Application configuration interface.
 *
 * Type-safe structure for all application settings. Organized by domain
 * (aws, sqs, workerPool, etc.) for clarity and maintainability.
 */
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
  /**
   * Worker thread pool configuration.
   *
   * Controls the behavior of the worker thread pool that handles parallel file processing.
   *
   * ## Configuration Guidelines:
   *
   * ### poolSize (Environment: WORKER_POOL_SIZE)
   * - Number of worker threads to spawn and maintain
   * - **Recommended**: Number of CPU cores (or cores - 1 to leave one for main thread)
   * - **Local development**: 2 workers (reduced load on dev machine)
   * - **Production**: 4-8 workers depending on container CPU allocation
   * - **Impact**: More workers = higher throughput but more memory usage
   *
   * ### maxConcurrentJobs (Environment: MAX_CONCURRENT_JOBS)
   * - Maximum number of jobs that can be processed simultaneously
   * - Acts as backpressure mechanism to prevent overload
   * - **Recommended**: 2-4x poolSize (allows queueing without overwhelming workers)
   * - **Local development**: 5 jobs
   * - **Production**: 20 jobs (for 4 workers)
   * - **Impact**: Higher = more parallelism but risk of memory exhaustion
   *
   * ### tempDir (Environment: TEMP_DIR)
   * - Local filesystem path for temporary file storage during processing
   * - Must be writable by application user
   * - **Local development**: `/tmp/exports`
   * - **Production (Fargate)**: `/tmp` (ephemeral storage, up to 20GB configurable)
   * - **Cleanup**: Temp files cleaned up after successful upload or on error
   *
   * ### maxFileSizeMb (Environment: MAX_FILE_SIZE_MB)
   * - Maximum file size in megabytes that workers will process
   * - Prevents disk/memory exhaustion from large downloads
   * - **Recommended**: 1024 MB (1 GB) for most use cases
   * - **Adjust based on**: Available memory, network bandwidth, processing time
   * - **Behavior**: Files exceeding limit fail with VALIDATION_ERROR (non-retryable)
   *
   * ## Tuning Recommendations:
   *
   * ### Memory-Constrained Environments (< 2GB RAM):
   * ```
   * WORKER_POOL_SIZE=2
   * MAX_CONCURRENT_JOBS=4
   * MAX_FILE_SIZE_MB=256
   * ```
   *
   * ### Balanced Production Setup (4GB RAM, 2 vCPU):
   * ```
   * WORKER_POOL_SIZE=4
   * MAX_CONCURRENT_JOBS=20
   * MAX_FILE_SIZE_MB=1024
   * ```
   *
   * ### High-Throughput Setup (8GB RAM, 4 vCPU):
   * ```
   * WORKER_POOL_SIZE=8
   * MAX_CONCURRENT_JOBS=40
   * MAX_FILE_SIZE_MB=1024
   * ```
   */
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
