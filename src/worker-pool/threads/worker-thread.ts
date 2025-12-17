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

const workerId: number = workerData?.workerId ?? 0;

function sendMessage<T>(type: WorkerMessageType, payload: T): void {
  const message: WorkerMessage<T> = {
    type,
    payload,
    timestamp: Date.now(),
  };
  parentPort?.postMessage(message);
}

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

function handleHealthCheck(): void {
  sendMessage<HealthResponsePayload>(WorkerMessageType.HEALTH_RESPONSE, {
    workerId,
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
  });
}

// Message handler
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

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in worker thread:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in worker thread:', reason);
  process.exit(1);
});

// Signal ready
// eslint-disable-next-line no-console
console.log(`Worker ${workerId} started`);
