/**
 * Worker Thread Communication Protocol
 *
 * This module defines the message types and payloads for bidirectional communication
 * between the main thread (PoolManagerService) and worker threads.
 *
 * ## Communication Model:
 * - **Main → Worker**: PROCESS_TASK, HEALTH_CHECK, SHUTDOWN
 * - **Worker → Main**: TASK_COMPLETED, TASK_FAILED, HEALTH_RESPONSE
 *
 * ## Message Flow Example:
 * ```
 * Main Thread                Worker Thread
 *     |                           |
 *     |---PROCESS_TASK----------->|
 *     |                           | (downloads file)
 *     |<-------TASK_COMPLETED-----|
 *     |                           |
 *     |---HEALTH_CHECK----------->|
 *     |<-------HEALTH_RESPONSE----|
 *     |                           |
 *     |---SHUTDOWN--------------->|
 *     |                           | (exits)
 * ```
 *
 * ## Structured Cloning:
 * All messages are serialized using the structured clone algorithm. Supported types:
 * - Primitives (string, number, boolean, null, undefined)
 * - Objects and arrays (deep cloned)
 * - Date, RegExp, Map, Set, TypedArrays
 * - NOT supported: Functions, Symbols, DOM nodes, circular references
 *
 * @module WorkerMessageInterface
 */

import { DownloadTask } from '../../shared/interfaces/download-task.interface';

/**
 * Message type enumeration for worker thread communication.
 *
 * ## Direction and Purpose:
 *
 * ### Main → Worker Messages:
 * - `PROCESS_TASK`: Send a download task to worker for processing
 * - `HEALTH_CHECK`: Request health metrics from worker
 * - `SHUTDOWN`: Request graceful worker termination
 *
 * ### Worker → Main Messages:
 * - `TASK_COMPLETED`: Report successful task completion
 * - `TASK_FAILED`: Report task failure with error details
 * - `HEALTH_RESPONSE`: Reply to health check with metrics
 */
export enum WorkerMessageType {
  PROCESS_TASK = 'PROCESS_TASK',
  TASK_COMPLETED = 'TASK_COMPLETED',
  TASK_FAILED = 'TASK_FAILED',
  SHUTDOWN = 'SHUTDOWN',
  HEALTH_CHECK = 'HEALTH_CHECK',
  HEALTH_RESPONSE = 'HEALTH_RESPONSE',
}

/**
 * Generic message wrapper for all worker thread communication.
 *
 * All messages sent between main and worker threads follow this structure,
 * providing type safety and consistent metadata.
 *
 * @template T - The payload type specific to the message (e.g., ProcessTaskPayload)
 *
 * @property type - Message type for routing in switch statements
 * @property payload - Type-safe payload with message-specific data
 * @property timestamp - Unix timestamp (ms) when message was created, used for:
 *   - Latency tracking: time between send and receive
 *   - Message ordering: detect out-of-order delivery
 *   - Timeout detection: identify stale messages
 *   - Performance monitoring: calculate message processing duration
 */
export interface WorkerMessage<T = unknown> {
  type: WorkerMessageType;
  payload: T;
  timestamp: number;
}

/**
 * Payload for PROCESS_TASK message (Main → Worker).
 *
 * Sent by PoolManagerService when dispatching a task to an idle worker.
 * Contains all information needed for the worker to download, process, and upload a file.
 *
 * @property task - The download task with URL, format, output location, identifiers
 * @property config - Worker configuration for file processing (paths, limits, AWS settings)
 */
export interface ProcessTaskPayload {
  task: DownloadTask;
  config: WorkerConfig;
}

/**
 * Worker configuration for file processing operations.
 *
 * Passed to worker with each PROCESS_TASK message. Contains environment-specific
 * settings needed for file download, transformation, and S3 upload.
 *
 * ## Configuration Sources:
 * - Environment variables (via ConfigService)
 * - Application defaults
 * - Runtime overrides (e.g., LocalStack endpoint)
 *
 * @property tempDir - Local filesystem path for temporary file storage (e.g., `/tmp/exports`)
 * @property maxFileSizeMb - Maximum file size in megabytes to prevent disk/memory exhaustion
 * @property s3BucketName - S3 bucket name for output uploads (e.g., `export-output-bucket`)
 * @property s3Prefix - S3 key prefix for organizing outputs (e.g., `exports/`)
 * @property awsRegion - AWS region for S3 client configuration (e.g., `us-east-1`)
 */
export interface WorkerConfig {
  tempDir: string;
  maxFileSizeMb: number;
  s3BucketName: string;
  s3Prefix: string;
  awsRegion: string;
}

/**
 * Payload for TASK_COMPLETED message (Worker → Main).
 *
 * Sent by worker thread when file processing completes successfully.
 * Contains result metadata and processing metrics.
 *
 * ## Success Criteria:
 * - File downloaded from source URL
 * - Format transformation applied (if needed)
 * - File uploaded to S3 successfully
 * - Output size within limits
 *
 * @property taskId - Unique task identifier for tracking (matches DownloadTask.taskId)
 * @property jobId - Parent job identifier for grouping related tasks
 * @property outputKey - S3 object key where result was uploaded (e.g., `exports/job-123/task-1.json`)
 * @property outputSize - File size in bytes after processing (used for quotas and billing)
 * @property processingTimeMs - Total time from task receipt to completion (for performance monitoring)
 */
export interface TaskCompletedPayload {
  taskId: string;
  jobId: string;
  outputKey: string;
  outputSize: number;
  processingTimeMs: number;
}

/**
 * Payload for TASK_FAILED message (Worker → Main).
 *
 * Sent by worker thread when file processing fails at any stage.
 * Contains error details and retry guidance.
 *
 * ## Common Failure Scenarios:
 * - Network errors: Source URL unreachable, timeout, connection reset
 * - Validation errors: Invalid format, file too large, unsupported content type
 * - S3 errors: Upload failed, permission denied, bucket not found
 * - Processing errors: Transformation failed, out of memory, invalid data
 *
 * ## Retry Strategy:
 * - `retryable: true`: Transient error, task can be retried (e.g., network timeout)
 * - `retryable: false`: Permanent error, retry will fail (e.g., invalid URL, file too large)
 *
 * @property taskId - Unique task identifier for tracking
 * @property jobId - Parent job identifier for grouping
 * @property error - Structured error information for debugging and retry decisions
 * @property error.code - Error code for categorization (e.g., `DOWNLOAD_FAILED`, `VALIDATION_ERROR`)
 * @property error.message - Human-readable error description
 * @property error.retryable - Whether task should be retried (guides SQS retry logic)
 * @property processingTimeMs - Time spent before failure (for timeout tuning)
 */
export interface TaskFailedPayload {
  taskId: string;
  jobId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
  processingTimeMs: number;
}

/**
 * Payload for HEALTH_RESPONSE message (Worker → Main).
 *
 * Sent by worker thread in response to HEALTH_CHECK message.
 * Contains worker health metrics for monitoring and load balancing.
 *
 * ## Use Cases:
 * - **Memory leak detection**: Track heapUsed growth over time
 * - **Load balancing**: Route tasks to workers with lower memory usage
 * - **Restart policies**: Kill and respawn workers exceeding memory threshold
 * - **Debugging crashes**: Log last known state before worker exit
 *
 * ## Memory Usage Fields (from Node.js process.memoryUsage()):
 * - `rss`: Resident Set Size - total memory allocated for process (includes heap, stack, code)
 * - `heapTotal`: Total V8 heap size allocated (includes used and free space)
 * - `heapUsed`: Actual memory used in V8 heap (indicates memory consumption)
 * - `external`: Memory used by C++ objects bound to JavaScript (e.g., Buffers)
 * - `arrayBuffers`: Memory allocated for ArrayBuffers and SharedArrayBuffers
 *
 * @property workerId - Worker identifier for correlation with logs and metrics
 * @property memoryUsage - Node.js memory usage metrics in bytes
 * @property uptime - Worker process uptime in seconds (time since worker started)
 */
export interface HealthResponsePayload {
  workerId: number;
  memoryUsage: NodeJS.MemoryUsage;
  uptime: number;
}
