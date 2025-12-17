/**
 * Worker Thread Entry Point
 *
 * This file runs in an isolated Node.js Worker Thread context (V8 isolate), separate from
 * the main thread. Each worker thread is a lightweight, long-lived process that handles
 * file download and processing tasks in parallel.
 *
 * ## Thread Architecture:
 *
 * ### Isolation:
 * - Runs in its own V8 isolate with separate heap and event loop
 * - Cannot access main thread memory directly
 * - Communicates via structured cloning (JSON-serializable messages)
 * - Has its own `process`, `console`, and global objects
 *
 * ### Communication Protocol:
 * - Main thread → Worker: Via `worker.postMessage()`
 * - Worker → Main thread: Via `parentPort.postMessage()`
 * - All messages follow the `WorkerMessage<T>` interface structure
 * - Message types: PROCESS_TASK, HEALTH_CHECK, SHUTDOWN, TASK_COMPLETED, TASK_FAILED
 *
 * ### Lifecycle:
 * 1. Worker is spawned by PoolManagerService with `new Worker(__filename, { workerData })`
 * 2. Initialization: Reads `workerId` from `workerData`, sets up message listeners
 * 3. Ready: Logs startup message, enters idle state waiting for tasks
 * 4. Active: Receives PROCESS_TASK message, downloads/processes file, sends result
 * 5. Idle: Returns to waiting state after completing task
 * 6. Shutdown: Receives SHUTDOWN message, exits gracefully with code 0
 *
 * ### Error Handling:
 * - Task-level errors: Caught and sent back as TASK_FAILED messages
 * - Uncaught exceptions: Logged and worker exits with code 1 (will be respawned)
 * - Unhandled rejections: Logged and worker exits with code 1 (will be respawned)
 *
 * ### Memory Management:
 * - Each worker has its own heap (default ~1.5GB on 64-bit)
 * - Memory usage reported via HEALTH_CHECK messages
 * - Isolated memory prevents one task from affecting others
 * - Worker respawn on crash provides memory cleanup
 *
 * @module WorkerThread
 */

import { parentPort, workerData } from 'worker_threads';
import {
  WorkerMessage,
  WorkerMessageType,
  ProcessTaskPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  HealthResponsePayload,
} from '../interfaces/worker-message.interface';
import { processFile } from './file-processor';

/**
 * Unique identifier for this worker thread.
 * Passed from main thread via workerData during Worker construction.
 * Used for logging and tracking which worker processed which task.
 */
const workerId: number = workerData?.workerId ?? 0;

/**
 * Send a structured message to the main thread via parentPort.
 *
 * This is the only communication mechanism available to worker threads. All data
 * is serialized using the structured clone algorithm (similar to JSON but supports
 * more types like Date, Map, Set, TypedArrays).
 *
 * ## Structured Cloning:
 * - Creates a deep copy of the message data
 * - No shared memory between threads (prevents race conditions)
 * - Cannot transfer functions, DOM nodes, or circular references
 * - Efficient for large data structures (no JSON stringify/parse overhead)
 *
 * ## Message Format:
 * All messages include:
 * - `type`: Message type enum for routing in main thread
 * - `payload`: Type-safe payload specific to message type
 * - `timestamp`: Message creation time for latency tracking
 *
 * @template T - The payload type (e.g., TaskCompletedPayload)
 * @param type - The message type for routing (e.g., TASK_COMPLETED)
 * @param payload - The message payload with task-specific data
 */
function sendMessage<T>(type: WorkerMessageType, payload: T): void {
  const message: WorkerMessage<T> = {
    type,
    payload,
    timestamp: Date.now(),
  };
  parentPort?.postMessage(message);
}

/**
 * Process a file download task in this worker thread.
 *
 * This is the main work handler that performs CPU/IO-intensive operations:
 * 1. Downloads file from remote URL
 * 2. Applies format transformations if needed
 * 3. Uploads result to S3
 * 4. Reports success or failure back to main thread
 *
 * ## Processing Flow:
 * - Delegates actual processing to `processFile()` function
 * - Tracks processing time for metrics and monitoring
 * - Handles both success and failure cases
 * - Sends structured response message to main thread
 *
 * ## Error Handling Strategy:
 * - **Expected errors** (network failures, validation): Caught by processFile(), returns `success: false`
 * - **Unexpected errors** (bugs, OOM): Caught by try/catch, marked as retryable with code 'UNKNOWN'
 * - All errors preserve task context (taskId, jobId) for tracking
 *
 * ## Thread Safety:
 * - Runs entirely in worker thread context
 * - No shared state with main thread or other workers
 * - All I/O operations are isolated to this thread
 * - Message passing is the only side effect visible to main thread
 *
 * @param payload - Contains the task to process and worker configuration
 * @returns Promise that resolves when result message is sent (does not return value)
 */
async function handleProcessTask(payload: ProcessTaskPayload): Promise<void> {
  const startTime = Date.now();
  const { task, config } = payload;

  try {
    const result = await processFile(task, config);
    const processingTimeMs = Date.now() - startTime;

    if (result.success) {
      sendMessage<TaskCompletedPayload>(WorkerMessageType.TASK_COMPLETED, {
        taskId: task.taskId,
        jobId: task.jobId,
        outputKey: result.outputKey!,
        outputSize: result.outputSize!,
        processingTimeMs,
      });
    } else {
      sendMessage<TaskFailedPayload>(WorkerMessageType.TASK_FAILED, {
        taskId: task.taskId,
        jobId: task.jobId,
        error: result.error!,
        processingTimeMs,
      });
    }
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    sendMessage<TaskFailedPayload>(WorkerMessageType.TASK_FAILED, {
      taskId: task.taskId,
      jobId: task.jobId,
      error: {
        code: 'UNKNOWN',
        message: (error as Error).message,
        retryable: true,
      },
      processingTimeMs,
    });
  }
}

/**
 * Handle health check request from main thread.
 *
 * Responds with worker health metrics including memory usage and uptime.
 * Used by PoolManagerService to monitor worker health and detect issues.
 *
 * ## Memory Usage Metrics:
 * - `rss`: Resident Set Size - total memory allocated for the process
 * - `heapTotal`: Total heap size allocated by V8
 * - `heapUsed`: Actual memory used by V8 heap
 * - `external`: Memory used by C++ objects bound to JS objects
 * - `arrayBuffers`: Memory allocated for ArrayBuffers and SharedArrayBuffers
 *
 * ## Use Cases:
 * - Detecting memory leaks (heapUsed continuously growing)
 * - Identifying overloaded workers (high heap usage)
 * - Calculating uptime for restart policies
 * - Debugging worker crashes (last known memory state)
 *
 * @returns void - Sends health response message asynchronously
 */
function handleHealthCheck(): void {
  sendMessage<HealthResponsePayload>(WorkerMessageType.HEALTH_RESPONSE, {
    workerId,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
  });
}

/**
 * Main message handler - the worker's event loop entry point.
 *
 * This listener receives all messages from the main thread via parentPort and
 * routes them to appropriate handlers based on message type.
 *
 * ## Message Types:
 *
 * ### PROCESS_TASK:
 * - Most common message type (main workload)
 * - Contains task details and configuration
 * - Async handler may take seconds/minutes to complete
 * - Worker remains responsive during processing (event loop continues)
 *
 * ### HEALTH_CHECK:
 * - Lightweight synchronous check
 * - Responds immediately with memory and uptime metrics
 * - Used for monitoring and load balancing decisions
 *
 * ### SHUTDOWN:
 * - Graceful termination signal
 * - Exits with code 0 (success)
 * - Main thread waits for exit before cleanup
 * - No need to finish in-progress tasks (handled by visibility timeout)
 *
 * ## Thread Safety:
 * - This handler runs in the worker's event loop
 * - Only one message processed at a time (serialized by event loop)
 * - Async handlers don't block message receiving (event loop remains responsive)
 * - No locking needed - V8 isolate provides isolation
 *
 * ## Error Handling:
 * - Unknown message types logged but don't crash worker
 * - Task processing errors caught and reported via TASK_FAILED
 * - Uncaught errors handled by global handlers below
 */
parentPort?.on('message', async (message: WorkerMessage) => {
  switch (message.type) {
    case WorkerMessageType.PROCESS_TASK:
      await handleProcessTask(message.payload as ProcessTaskPayload);
      break;

    case WorkerMessageType.HEALTH_CHECK:
      handleHealthCheck();
      break;

    case WorkerMessageType.SHUTDOWN:
      process.exit(0);
      break;

    default:
      console.error(`Unknown message type: ${message.type}`);
  }
});

/**
 * Global error handlers for worker thread stability.
 *
 * ## Uncaught Exception Handler:
 * Catches synchronous errors that escape try/catch blocks. Examples:
 * - Bugs in worker code (null reference, type errors)
 * - Errors in third-party libraries
 * - Native module crashes
 *
 * **Strategy**: Log and exit with code 1
 * - Prevents worker from entering undefined state
 * - PoolManagerService detects exit and spawns replacement
 * - In-progress task will timeout and retry via SQS visibility timeout
 *
 * ## Unhandled Rejection Handler:
 * Catches async errors from promises without .catch() handlers. Examples:
 * - Forgotten await without try/catch
 * - Promise rejections in event callbacks
 * - Async errors in third-party code
 *
 * **Strategy**: Log and exit with code 1
 * - Same recovery mechanism as uncaught exceptions
 * - Prevents silent failures and zombie workers
 *
 * ## Why Exit Instead of Continue:
 * - Worker may be in corrupted state (memory leaks, broken connections)
 * - Better to fail fast and restart than continue with undefined behavior
 * - SQS visibility timeout ensures no task loss (task becomes visible again)
 * - Pool manager automatically maintains pool size by respawning
 *
 * ## Production Considerations:
 * - High exit rate indicates bugs in worker code (monitor worker restarts)
 * - Consider structured logging service for error aggregation
 * - Set alerts on worker restart rate
 */
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in worker thread:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in worker thread:', reason);
  process.exit(1);
});

/**
 * Worker startup signal.
 *
 * Logged to stdout for observability and debugging. In production, this helps:
 * - Verify workers are spawning correctly
 * - Track worker lifecycle in container logs
 * - Correlate workerId with task processing logs
 * - Calculate time-to-ready for performance monitoring
 *
 * After this log, worker enters idle state waiting for PROCESS_TASK messages.
 */
// eslint-disable-next-line no-console
console.log(`Worker ${workerId} started`);
