import { z } from 'zod';

export const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // AWS
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_ENDPOINT: z.string().url().optional(), // For LocalStack

  // SQS
  SQS_EXPORT_JOBS_URL: z.string().url(),
  SQS_DOWNLOAD_TASKS_URL: z.string().url(),
  SQS_MAX_MESSAGES: z.coerce.number().min(1).max(10).default(10),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().min(0).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT: z.coerce.number().min(0).max(43200).default(900),

  // DynamoDB
  DYNAMODB_TABLE_NAME: z.string().default('export-job-state'),

  // S3
  S3_BUCKET_NAME: z.string(),
  S3_PREFIX: z.string().default('exports/'),

  // Export API
  EXPORT_API_BASE_URL: z.string().url(),
  EXPORT_API_TIMEOUT: z.coerce.number().default(30000),
  EXPORT_API_MAX_RETRIES: z.coerce.number().default(3),

  // Worker Pool
  WORKER_POOL_SIZE: z.coerce.number().min(1).max(16).default(4),
  MAX_CONCURRENT_JOBS: z.coerce.number().min(1).default(20),
  TEMP_DIR: z.string().default('/tmp/exports'),
  MAX_FILE_SIZE_MB: z.coerce.number().default(1024),

  // Orchestrator
  POLLING_INTERVAL_MS: z.coerce.number().default(180000),
  MAX_POLLING_ATTEMPTS: z.coerce.number().default(60),
  DISPATCH_BATCH_SIZE: z.coerce.number().default(10),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}
