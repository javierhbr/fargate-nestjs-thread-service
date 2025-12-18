# Worker Pool Unit Tests - Test Case Documentation

## Overview

This document outlines comprehensive test scenarios for the worker pool implementation located in `src/worker-pool`. The worker pool manages Node.js worker threads for parallel file processing with S3 downloads, checksum validation, and uploads.

## Components Under Test

### 1. PoolManagerService (`pool-manager.service.ts`)
- **Responsibility**: Orchestrates worker lifecycle, task distribution, and queue management
- **Key Features**: Worker pool management, FIFO task queue, graceful shutdown, event emission
- **Dependencies**: Node.js Worker, EventEmitter, NestJS lifecycle hooks

### 2. Worker Thread (`threads/worker-thread.ts`)
- **Responsibility**: Worker thread entry point, message handling, error isolation
- **Key Features**: Message protocol implementation, health checks, uncaught error handling
- **Dependencies**: parentPort, FileProcessor, MessageProtocol

### 3. File Processor (`threads/file-processor.ts`)
- **Responsibility**: Core file processing with streaming, validation, S3 upload
- **Key Features**: Single-pass streaming pipeline, checksum validation, S3 multipart upload
- **Dependencies**: AWS SDK, crypto, stream

## Test File Structure

```
test/unit/worker-pool/
├── TestCase.md                           # This file
├── pool-manager.service.spec.ts          # ~100+ tests
├── worker-thread.spec.ts                 # ~40+ tests
├── file-processor.spec.ts                # ~80+ tests
└── helpers/
    └── mock-factories.ts                 # Mock factories for workers, streams, S3
```

## Testing Patterns

- **Framework**: Vitest
- **Style**: Plain class-based tests (no NestJS testing utilities)
- **Mock Pattern**: Factory functions returning mock objects
- **Assertion Style**: Expect-style assertions
- **Coverage Focus**: Edge cases, concurrency, resource cleanup, error handling

---

# Test Scenarios

## 1. PoolManagerService Tests

### 1.1 Initialization & Module Lifecycle

#### Test: Should initialize with default configuration
- **Scenario**: Create service instance without custom config
- **Expected**:
  - Pool size defaults to CPU count
  - Queue max size defaults to 1000
  - Workers map is empty
  - Task queue is empty
  - Pending tasks map is empty

#### Test: Should initialize with custom configuration
- **Scenario**: Create service with custom pool size and queue size
- **Expected**:
  - Pool size matches config
  - Queue max size matches config
  - Configuration properly applied

#### Test: Should create worker pool on module init
- **Scenario**: Call onModuleInit()
- **Expected**:
  - Creates correct number of workers
  - Each worker has unique ID
  - Workers are marked as inactive initially
  - Workers are added to workers map
  - Event 'poolReady' emitted

#### Test: Should handle worker creation failure during init
- **Scenario**: Worker constructor throws error during onModuleInit()
- **Expected**:
  - Error logged
  - Continues creating remaining workers
  - Pool initialized with fewer workers
  - Service remains functional

#### Test: Should handle partial worker pool initialization
- **Scenario**: Some workers fail to create during init
- **Expected**:
  - Successfully created workers are available
  - Failed workers logged
  - Pool operates with reduced capacity

### 1.2 Task Submission & Queuing

#### Test: Should submit task when workers available
- **Scenario**: Submit task with idle workers in pool
- **Expected**:
  - Returns promise
  - Task assigned to available worker
  - Worker marked as active
  - Worker receives PROCESS_TASK message
  - Task added to pendingTasks map
  - Event 'taskAssigned' emitted

#### Test: Should queue task when all workers busy
- **Scenario**: Submit task when all workers processing tasks
- **Expected**:
  - Task added to taskQueue
  - Promise remains pending
  - Event 'taskQueued' emitted
  - Task not sent to worker yet

#### Test: Should reject task when queue is full
- **Scenario**: Submit task when queue reached max size
- **Expected**:
  - Promise rejected immediately
  - Error message indicates queue full
  - Task not added to queue
  - Event 'taskRejected' emitted

#### Test: Should handle multiple concurrent task submissions
- **Scenario**: Submit 100 tasks rapidly
- **Expected**:
  - Tasks distributed to available workers
  - Remaining tasks queued in order
  - No tasks lost
  - All promises tracked correctly

#### Test: Should maintain FIFO order in task queue
- **Scenario**: Submit tasks T1, T2, T3 when workers busy
- **Expected**:
  - Tasks queued in order: [T1, T2, T3]
  - When worker becomes available, T1 assigned first
  - Then T2, then T3

#### Test: Should handle task submission with invalid task data
- **Scenario**: Submit task with missing required fields
- **Expected**:
  - Promise rejected
  - Validation error message
  - Task not queued or assigned

#### Test: Should handle task submission during shutdown
- **Scenario**: Submit task while shutdown in progress
- **Expected**:
  - Promise rejected
  - Error indicates shutdown in progress
  - Task not processed

### 1.3 Task Distribution

#### Test: Should assign queued task when worker becomes available
- **Scenario**: Worker completes task, queue has pending tasks
- **Expected**:
  - First task from queue removed
  - Task assigned to now-idle worker
  - Worker marked active
  - Event 'taskDequeued' emitted

#### Test: Should distribute tasks across multiple workers evenly
- **Scenario**: Submit tasks equal to worker count
- **Expected**:
  - Each worker receives exactly one task
  - No worker left idle
  - No tasks in queue

#### Test: Should handle worker availability race condition
- **Scenario**: Multiple workers complete simultaneously, one queued task
- **Expected**:
  - Only one worker receives the task
  - Other workers remain idle
  - No duplicate task assignment

#### Test: Should prioritize oldest queued task
- **Scenario**: Multiple tasks in queue, worker becomes available
- **Expected**:
  - Task with earliest submission time assigned
  - FIFO order maintained

### 1.4 Worker Message Handling

#### Test: Should handle TASK_COMPLETED message
- **Scenario**: Worker sends successful completion message
- **Expected**:
  - Pending task promise resolved
  - Task removed from pendingTasks
  - Worker marked inactive
  - Worker stats updated (tasksCompleted++)
  - Event 'taskCompleted' emitted
  - Worker lastActivityAt updated

#### Test: Should handle TASK_FAILED message
- **Scenario**: Worker sends failure message
- **Expected**:
  - Pending task promise rejected
  - Task removed from pendingTasks
  - Worker marked inactive
  - Worker stats updated (tasksFailed++)
  - Event 'taskFailed' emitted
  - Error details logged

#### Test: Should handle HEALTH_RESPONSE message
- **Scenario**: Worker responds to health check
- **Expected**:
  - Worker lastActivityAt updated
  - Worker marked healthy
  - Health check timeout cleared

#### Test: Should handle unexpected message type
- **Scenario**: Worker sends unknown message type
- **Expected**:
  - Warning logged
  - Message ignored
  - No state changes

#### Test: Should handle message from terminated worker
- **Scenario**: Receive message from worker ID not in map
- **Expected**:
  - Warning logged
  - Message ignored
  - No errors thrown

#### Test: Should handle malformed message data
- **Scenario**: Worker sends message with invalid structure
- **Expected**:
  - Error logged
  - Worker potentially restarted
  - No state corruption

### 1.5 Worker Failure & Recovery

#### Test: Should detect worker crash
- **Scenario**: Worker process exits unexpectedly
- **Expected**:
  - Error event detected
  - Worker removed from pool
  - New worker created
  - Event 'workerCrashed' emitted

#### Test: Should fail pending task when worker crashes
- **Scenario**: Worker crashes while processing task
- **Expected**:
  - Task promise rejected
  - Error indicates worker crash
  - Task removed from pending
  - Client receives error

#### Test: Should restart crashed worker
- **Scenario**: Worker exits with code 1
- **Expected**:
  - New worker created with same ID
  - Worker added back to pool
  - Pool capacity restored
  - Event 'workerRestarted' emitted

#### Test: Should handle worker restart failure
- **Scenario**: Worker crashes, restart fails
- **Expected**:
  - Error logged
  - Pool continues with reduced capacity
  - No infinite restart loop

#### Test: Should handle worker exit code 0 (graceful)
- **Scenario**: Worker exits normally with code 0
- **Expected**:
  - Worker removed
  - No restart attempted (expected shutdown)
  - Pool size reduced

#### Test: Should detect unhealthy worker via timeout
- **Scenario**: Worker doesn't respond to health check
- **Expected**:
  - Worker marked unhealthy
  - Worker terminated
  - New worker created
  - Pending task failed

#### Test: Should handle worker unresponsive during task
- **Scenario**: Worker processing task, stops responding
- **Expected**:
  - Task timeout triggers
  - Worker terminated
  - Task failed
  - New worker created

#### Test: Should prevent worker restart storm
- **Scenario**: Worker crashes immediately 5 times in a row
- **Expected**:
  - After threshold, stop restarting
  - Error logged
  - Pool operates with reduced capacity
  - No infinite loop

### 1.6 Graceful Shutdown

#### Test: Should shutdown cleanly with no active tasks
- **Scenario**: Call shutdown() with idle workers
- **Expected**:
  - SHUTDOWN message sent to all workers
  - All workers terminated
  - Workers map cleared
  - Module destroyed cleanly

#### Test: Should wait for active tasks before shutdown
- **Scenario**: Call shutdown() with workers processing tasks
- **Expected**:
  - No new tasks accepted
  - Waits for active tasks to complete
  - Then sends SHUTDOWN messages
  - All workers terminated
  - All promises resolved/rejected

#### Test: Should reject queued tasks during shutdown
- **Scenario**: Call shutdown() with tasks in queue
- **Expected**:
  - Queued tasks rejected immediately
  - Error indicates shutdown
  - Queue cleared
  - Active tasks complete normally

#### Test: Should handle shutdown timeout
- **Scenario**: Worker doesn't complete task within shutdown timeout
- **Expected**:
  - Force terminate worker after timeout
  - Task promise rejected
  - Shutdown completes

#### Test: Should handle worker crash during shutdown
- **Scenario**: Worker crashes while shutdown in progress
- **Expected**:
  - Error logged
  - Worker removed
  - Shutdown continues
  - No restart attempted

#### Test: Should handle multiple shutdown calls
- **Scenario**: Call shutdown() twice
- **Expected**:
  - Second call waits for first shutdown
  - No duplicate terminations
  - No errors thrown

#### Test: Should cleanup all resources on shutdown
- **Scenario**: Shutdown with various states
- **Expected**:
  - Workers map cleared
  - Task queue cleared
  - Pending tasks map cleared
  - All promises settled
  - No memory leaks

### 1.7 Capacity Management

#### Test: Should report correct pool statistics
- **Scenario**: Get pool stats during various states
- **Expected**:
  - Correct totalWorkers count
  - Correct activeWorkers count
  - Correct queuedTasks count
  - Correct pendingTasks count

#### Test: Should scale workers based on configuration
- **Scenario**: Initialize with different pool sizes
- **Expected**:
  - Pool size matches config
  - Can handle up to pool size concurrent tasks

#### Test: Should handle zero pool size configuration
- **Scenario**: Configure pool with size 0
- **Expected**:
  - Error or defaults to 1
  - Service remains functional

#### Test: Should handle excessive pool size
- **Scenario**: Configure pool size larger than system resources
- **Expected**:
  - Warning logged
  - Pool created (system may throttle)

### 1.8 Statistics & Monitoring

#### Test: Should track task completion count
- **Scenario**: Process multiple tasks successfully
- **Expected**:
  - Each worker tracks tasksCompleted
  - Global stats updated

#### Test: Should track task failure count
- **Scenario**: Process tasks with failures
- **Expected**:
  - Each worker tracks tasksFailed
  - Global stats updated

#### Test: Should track worker activity timestamp
- **Scenario**: Worker processes tasks
- **Expected**:
  - lastActivityAt updated on each message
  - Timestamp accurate

#### Test: Should provide worker health status
- **Scenario**: Query worker health
- **Expected**:
  - Reports healthy/unhealthy
  - Based on lastActivityAt and responses

### 1.9 Event Emission

#### Test: Should emit poolReady event after initialization
- **Scenario**: Module init completes
- **Expected**: Event emitted with pool stats

#### Test: Should emit taskAssigned event
- **Scenario**: Task assigned to worker
- **Expected**: Event with taskId and workerId

#### Test: Should emit taskQueued event
- **Scenario**: Task added to queue
- **Expected**: Event with taskId and queue size

#### Test: Should emit taskCompleted event
- **Scenario**: Task completes successfully
- **Expected**: Event with taskId, workerId, result

#### Test: Should emit taskFailed event
- **Scenario**: Task fails
- **Expected**: Event with taskId, workerId, error

#### Test: Should emit workerCrashed event
- **Scenario**: Worker exits unexpectedly
- **Expected**: Event with workerId

#### Test: Should emit workerRestarted event
- **Scenario**: Worker restarted after crash
- **Expected**: Event with workerId

### 1.10 Edge Cases & Concurrency

#### Test: Should handle rapid worker churn
- **Scenario**: Workers crash and restart continuously
- **Expected**:
  - Pool remains functional
  - Tasks eventually complete
  - No memory leaks

#### Test: Should handle task result race condition
- **Scenario**: Worker sends result, then crashes immediately
- **Expected**:
  - Task result received
  - Promise resolved
  - Crash handled separately

#### Test: Should handle concurrent task completion
- **Scenario**: All workers complete simultaneously
- **Expected**:
  - All promises resolved
  - All workers marked inactive
  - Queue processed correctly

#### Test: Should handle message loss (worker thread dies mid-message)
- **Scenario**: Worker dies while sending message
- **Expected**:
  - Task fails due to worker death
  - No hung promises

#### Test: Should handle queue overflow with concurrent submissions
- **Scenario**: 1000 tasks submitted simultaneously, queue size 100
- **Expected**:
  - First tasks assigned to workers
  - Next 100 queued
  - Remaining rejected
  - No data corruption

#### Test: Should handle worker ID collision
- **Scenario**: Worker restarts with same ID
- **Expected**:
  - Old worker cleaned up
  - New worker registered
  - No state conflicts

#### Test: Should handle undefined/null task data
- **Scenario**: Submit task with null values
- **Expected**:
  - Validation error
  - Task rejected

#### Test: Should handle worker message during shutdown race
- **Scenario**: Worker completes task exactly when shutdown called
- **Expected**:
  - Task result handled
  - Worker shutdown proceeds
  - No errors

---

## 2. Worker Thread Tests

### 2.1 Worker Initialization

#### Test: Should initialize worker thread successfully
- **Scenario**: Worker thread starts
- **Expected**:
  - parentPort available
  - Message listener registered
  - Process error handlers registered
  - Ready to receive messages

#### Test: Should handle missing parentPort
- **Scenario**: Worker runs without parentPort
- **Expected**:
  - Error logged
  - Worker exits gracefully

#### Test: Should initialize error handlers
- **Scenario**: Register uncaughtException and unhandledRejection handlers
- **Expected**:
  - Handlers registered
  - Process exits on uncaught errors

### 2.2 Message Handling - PROCESS_TASK

#### Test: Should process PROCESS_TASK message successfully
- **Scenario**: Receive valid PROCESS_TASK message
- **Expected**:
  - Task extracted from payload
  - FileProcessor called with task
  - TASK_COMPLETED message sent to parent
  - Result includes taskId

#### Test: Should handle PROCESS_TASK with missing task data
- **Scenario**: PROCESS_TASK message without task payload
- **Expected**:
  - TASK_FAILED message sent
  - Error indicates missing data

#### Test: Should handle FileProcessor error
- **Scenario**: FileProcessor throws error during processing
- **Expected**:
  - Error caught
  - TASK_FAILED message sent with error
  - Worker remains alive

#### Test: Should handle FileProcessor timeout
- **Scenario**: FileProcessor exceeds timeout
- **Expected**:
  - Processing aborted
  - TASK_FAILED message sent
  - Resources cleaned up

### 2.3 Message Handling - HEALTH_CHECK

#### Test: Should respond to HEALTH_CHECK message
- **Scenario**: Receive HEALTH_CHECK message
- **Expected**:
  - HEALTH_RESPONSE message sent immediately
  - Response includes timestamp

#### Test: Should respond to health check during task processing
- **Scenario**: HEALTH_CHECK received while processing task
- **Expected**:
  - HEALTH_RESPONSE sent
  - Task processing continues
  - No interference

### 2.4 Message Handling - SHUTDOWN

#### Test: Should handle SHUTDOWN message
- **Scenario**: Receive SHUTDOWN message
- **Expected**:
  - Cleanup performed
  - Process exits with code 0

#### Test: Should handle SHUTDOWN during task processing
- **Scenario**: SHUTDOWN received while processing task
- **Expected**:
  - Task aborted
  - Resources cleaned up
  - Process exits

### 2.5 Error Handling

#### Test: Should handle uncaughtException
- **Scenario**: Uncaught exception thrown in worker
- **Expected**:
  - Error logged
  - TASK_FAILED message sent if task active
  - Process exits with code 1

#### Test: Should handle unhandledRejection
- **Scenario**: Promise rejection not caught
- **Expected**:
  - Error logged
  - TASK_FAILED message sent if task active
  - Process exits with code 1

#### Test: Should handle malformed message
- **Scenario**: Receive message with invalid structure
- **Expected**:
  - Warning logged
  - Message ignored
  - Worker remains functional

#### Test: Should handle unknown message type
- **Scenario**: Receive message with unrecognized type
- **Expected**:
  - Warning logged
  - Message ignored

### 2.6 Message Protocol

#### Test: Should send TASK_COMPLETED with correct structure
- **Scenario**: Task completes successfully
- **Expected**:
  - Message type: TASK_COMPLETED
  - Payload includes taskId, result, metadata

#### Test: Should send TASK_FAILED with error details
- **Scenario**: Task fails
- **Expected**:
  - Message type: TASK_FAILED
  - Payload includes taskId, error message, stack trace

#### Test: Should send HEALTH_RESPONSE with timestamp
- **Scenario**: Health check received
- **Expected**:
  - Message type: HEALTH_RESPONSE
  - Payload includes timestamp, worker state

### 2.7 Resource Management

#### Test: Should cleanup resources after task completion
- **Scenario**: Task completes
- **Expected**:
  - File handles closed
  - Streams destroyed
  - Memory released

#### Test: Should cleanup resources after task failure
- **Scenario**: Task fails
- **Expected**:
  - All resources cleaned up
  - No resource leaks

#### Test: Should handle multiple tasks sequentially
- **Scenario**: Process task A, then task B
- **Expected**:
  - Task A resources cleaned before B starts
  - No interference between tasks

### 2.8 Edge Cases

#### Test: Should handle rapid sequential messages
- **Scenario**: Multiple messages sent in quick succession
- **Expected**:
  - All messages processed in order
  - No message loss

#### Test: Should handle message during error handling
- **Scenario**: Error occurs, then message received
- **Expected**:
  - Error handling completes
  - Message processed or worker exits

#### Test: Should handle parentPort closure
- **Scenario**: parentPort closes unexpectedly
- **Expected**:
  - Error detected
  - Worker exits gracefully

---

## 3. File Processor Tests

### 3.1 Successful File Processing

#### Test: Should process file successfully with valid inputs
- **Scenario**: Process file with valid S3 URL, metadata
- **Expected**:
  - File downloaded from source
  - Checksum calculated
  - File uploaded to destination
  - Result includes size, checksum, upload metadata

#### Test: Should handle small file (< 5MB)
- **Scenario**: Process file smaller than multipart threshold
- **Expected**:
  - Single-part upload used
  - Checksum validated
  - Success result

#### Test: Should handle large file (> 5MB)
- **Scenario**: Process file requiring multipart upload
- **Expected**:
  - Multipart upload used
  - All parts uploaded
  - Upload completed
  - Checksum validated

#### Test: Should handle empty file (0 bytes)
- **Scenario**: Process zero-byte file
- **Expected**:
  - Download succeeds
  - Upload succeeds
  - Size validation passes
  - Checksum calculated (hash of empty)

### 3.2 Download Phase

#### Test: Should download file from HTTP URL
- **Scenario**: Source URL is HTTP
- **Expected**:
  - HTTP GET request made
  - Stream created
  - Data received

#### Test: Should download file from HTTPS URL
- **Scenario**: Source URL is HTTPS
- **Expected**:
  - HTTPS GET request made
  - SSL verified
  - Stream created

#### Test: Should handle download with redirect
- **Scenario**: URL returns 3xx redirect
- **Expected**:
  - Follow redirect
  - Download from final URL
  - Success

#### Test: Should handle 404 Not Found
- **Scenario**: Source URL returns 404
- **Expected**:
  - Error thrown
  - Error type: RETRYABLE (temporary)
  - Task failed

#### Test: Should handle 403 Forbidden
- **Scenario**: Source URL returns 403
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE
  - Task failed permanently

#### Test: Should handle network timeout
- **Scenario**: Download stalls, timeout exceeded
- **Expected**:
  - Request aborted
  - Error type: RETRYABLE
  - Resources cleaned up

#### Test: Should handle connection refused
- **Scenario**: Cannot connect to host
- **Expected**:
  - Error thrown
  - Error type: RETRYABLE
  - Task failed

#### Test: Should handle DNS resolution failure
- **Scenario**: Hostname cannot be resolved
- **Expected**:
  - Error thrown
  - Error type: RETRYABLE

#### Test: Should handle partial download
- **Scenario**: Connection drops mid-download
- **Expected**:
  - Error detected
  - Stream destroyed
  - Error type: RETRYABLE

#### Test: Should handle malformed URL
- **Scenario**: Invalid URL format
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE

### 3.3 Checksum Validation

#### Test: Should calculate SHA-256 checksum
- **Scenario**: Process file with SHA-256 algorithm
- **Expected**:
  - Checksum calculated during streaming
  - Result matches expected hash
  - No extra file reads

#### Test: Should calculate MD5 checksum
- **Scenario**: Process file with MD5 algorithm
- **Expected**:
  - MD5 hash calculated
  - Result matches expected

#### Test: Should validate checksum matches expected
- **Scenario**: Downloaded file checksum matches provided hash
- **Expected**:
  - Validation passes
  - Upload proceeds

#### Test: Should fail on checksum mismatch
- **Scenario**: Downloaded file checksum differs from expected
- **Expected**:
  - Validation error thrown
  - Error type: NON_RETRYABLE
  - Upload aborted

#### Test: Should handle missing checksum algorithm
- **Scenario**: No algorithm specified
- **Expected**:
  - Default algorithm used (SHA-256)
  - Checksum calculated

#### Test: Should handle unsupported algorithm
- **Scenario**: Algorithm not supported
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE

### 3.4 Size Validation

#### Test: Should validate file size matches expected
- **Scenario**: Downloaded size matches metadata
- **Expected**:
  - Validation passes
  - Upload proceeds

#### Test: Should fail when size exceeds expected
- **Scenario**: Downloaded file larger than expected
- **Expected**:
  - Validation error
  - Error type: NON_RETRYABLE
  - Upload aborted

#### Test: Should fail when size less than expected
- **Scenario**: Downloaded file smaller than expected
- **Expected**:
  - Validation error
  - Error type: NON_RETRYABLE

#### Test: Should track bytes processed during streaming
- **Scenario**: Monitor size during download
- **Expected**:
  - Size incremented as chunks received
  - Final size accurate

### 3.5 S3 Upload

#### Test: Should upload file to S3 successfully
- **Scenario**: Valid S3 bucket and key
- **Expected**:
  - Upload completes
  - ETag returned
  - Metadata attached

#### Test: Should handle multipart upload
- **Scenario**: Large file requiring multipart
- **Expected**:
  - Multiple parts uploaded
  - Parts completed in order
  - Upload finalized

#### Test: Should attach metadata to S3 object
- **Scenario**: Upload with custom metadata
- **Expected**:
  - Metadata included in upload
  - Metadata retrievable from S3

#### Test: Should handle S3 access denied
- **Scenario**: No permission to write to bucket
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE

#### Test: Should handle S3 bucket not found
- **Scenario**: Bucket does not exist
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE

#### Test: Should handle S3 network error during upload
- **Scenario**: Network fails mid-upload
- **Expected**:
  - Upload aborted
  - Error type: RETRYABLE

#### Test: Should handle S3 rate limiting
- **Scenario**: Too many requests to S3
- **Expected**:
  - Error thrown
  - Error type: RETRYABLE

#### Test: Should handle S3 server error (500)
- **Scenario**: S3 returns internal server error
- **Expected**:
  - Error thrown
  - Error type: RETRYABLE

#### Test: Should abort upload on validation failure
- **Scenario**: Checksum fails after download starts
- **Expected**:
  - S3 upload aborted
  - No incomplete multipart uploads left
  - Resources cleaned

### 3.6 Streaming Pipeline

#### Test: Should create proper stream pipeline
- **Scenario**: Build download → checksum → size → upload pipeline
- **Expected**:
  - Streams piped correctly
  - Single pass through data
  - No intermediate buffering

#### Test: Should handle backpressure
- **Scenario**: Upload slower than download
- **Expected**:
  - Download pauses when upload buffer full
  - No memory overflow
  - Stream resumes when upload catches up

#### Test: Should handle stream error in download
- **Scenario**: Download stream emits error
- **Expected**:
  - Error propagates through pipeline
  - All streams destroyed
  - Task fails

#### Test: Should handle stream error in transform
- **Scenario**: Checksum stream fails
- **Expected**:
  - Pipeline aborted
  - Resources cleaned
  - Error reported

#### Test: Should handle stream error in upload
- **Scenario**: S3 upload stream errors
- **Expected**:
  - Download stopped
  - Resources cleaned
  - Error reported

#### Test: Should cleanup streams on success
- **Scenario**: File processing completes
- **Expected**:
  - All streams destroyed
  - No open handles
  - Memory released

#### Test: Should cleanup streams on failure
- **Scenario**: Processing fails mid-stream
- **Expected**:
  - All streams destroyed
  - No resource leaks
  - Handles closed

### 3.7 Error Classification

#### Test: Should classify network errors as retryable
- **Scenario**: ECONNREFUSED, ETIMEDOUT, etc.
- **Expected**:
  - Error type: RETRYABLE
  - Task can be retried

#### Test: Should classify validation errors as non-retryable
- **Scenario**: Checksum mismatch, size mismatch
- **Expected**:
  - Error type: NON_RETRYABLE
  - Task fails permanently

#### Test: Should classify permission errors as non-retryable
- **Scenario**: 403, S3 access denied
- **Expected**:
  - Error type: NON_RETRYABLE

#### Test: Should classify server errors as retryable
- **Scenario**: 500, 503 errors
- **Expected**:
  - Error type: RETRYABLE

#### Test: Should classify client errors (4xx) as non-retryable
- **Scenario**: 400, 404 errors
- **Expected**:
  - Error type: NON_RETRYABLE

#### Test: Should include error details in result
- **Scenario**: Task fails
- **Expected**:
  - Error message included
  - Error type specified
  - Stack trace available (if error)

### 3.8 Configuration

#### Test: Should use custom timeout from config
- **Scenario**: Config specifies 30s timeout
- **Expected**:
  - Download aborts after 30s
  - Upload aborts after 30s

#### Test: Should use custom checksum algorithm
- **Scenario**: Config specifies MD5
- **Expected**:
  - MD5 used instead of SHA-256

#### Test: Should use S3 config from environment
- **Scenario**: AWS credentials in config
- **Expected**:
  - S3 client uses credentials
  - Upload succeeds

#### Test: Should handle missing required config
- **Scenario**: S3 bucket not in config
- **Expected**:
  - Error thrown
  - Error type: NON_RETRYABLE

### 3.9 Edge Cases

#### Test: Should handle concurrent checksum and size validation
- **Scenario**: Both validations occur simultaneously
- **Expected**:
  - No race conditions
  - Both validations complete
  - Result accurate

#### Test: Should handle file size exactly at multipart threshold
- **Scenario**: File is exactly 5MB
- **Expected**:
  - Appropriate upload strategy chosen
  - Success

#### Test: Should handle very large file (> 1GB)
- **Scenario**: Multi-GB file download and upload
- **Expected**:
  - Streaming prevents memory overflow
  - Multipart upload succeeds
  - No timeouts

#### Test: Should handle special characters in filenames
- **Scenario**: S3 key with spaces, unicode
- **Expected**:
  - Proper URL encoding
  - Upload succeeds

#### Test: Should handle zero-length checksum
- **Scenario**: Empty file checksum validation
- **Expected**:
  - Valid hash calculated
  - Validation passes

#### Test: Should handle stream pause/resume
- **Scenario**: Backpressure causes pause
- **Expected**:
  - Stream pauses correctly
  - Resumes when ready
  - No data loss

#### Test: Should handle rapid stream events
- **Scenario**: Many small chunks received quickly
- **Expected**:
  - All chunks processed
  - Checksum accurate
  - Size accurate

### 3.10 Resource Management

#### Test: Should not leak memory during processing
- **Scenario**: Process multiple files sequentially
- **Expected**:
  - Memory usage stable
  - No accumulation

#### Test: Should close all file handles
- **Scenario**: Processing completes or fails
- **Expected**:
  - All handles closed
  - No open file descriptors

#### Test: Should abort S3 multipart uploads on failure
- **Scenario**: Task fails mid-multipart upload
- **Expected**:
  - Multipart upload aborted
  - No orphaned parts in S3

#### Test: Should handle stream destruction idempotency
- **Scenario**: Stream.destroy() called multiple times
- **Expected**:
  - No errors
  - Resources cleaned once

---

## Mock Factories Required

### `createMockWorker()`
- Returns mock Worker instance
- Supports postMessage, terminate, on/off methods
- Configurable message responses
- Simulates worker lifecycle events

### `createMockS3Client()`
- Returns mock S3 client
- Supports Upload class mock
- Configurable upload success/failure
- Supports multipart upload simulation

### `createMockStream()`
- Returns mock readable/writable stream
- Supports pipe, on, destroy
- Simulates data chunks
- Simulates errors

### `createMockFileProcessor()`
- Returns mock file processor
- Configurable success/failure
- Simulates processing time
- Returns mock results

### `createBlockingDetector()`
- Detects synchronous blocking operations
- Tracks event loop delays
- Reports blocking calls

### `createMockLogger()`
- Returns mock logger with log, error, warn methods
- Tracks log calls for assertions

---

## Success Criteria

### Coverage Targets
- **Line Coverage**: > 90%
- **Branch Coverage**: > 85%
- **Function Coverage**: > 90%

### Quality Metrics
- All edge cases documented and tested
- No synchronous blocking operations
- All resources properly cleaned up
- All error paths tested
- Concurrency scenarios validated

### Test Execution
- All tests pass consistently
- No flaky tests
- Execution time < 10 seconds total
- No memory leaks during test runs

---

## Implementation Notes

1. **Test Isolation**: Each test should be completely isolated with fresh mocks
2. **Async Handling**: Proper async/await usage, no unhandled promises
3. **Resource Cleanup**: Use afterEach to cleanup mocks and timers
4. **Error Testing**: Use expect().rejects.toThrow() for async errors
5. **Mock Verification**: Verify mock calls with toHaveBeenCalledWith()
6. **Concurrent Testing**: Use Promise.all for concurrent scenarios
7. **Stream Testing**: Mock streams with proper event emission
8. **Worker Thread Testing**: Mock parentPort and Worker class
9. **Timing**: Use vi.useFakeTimers() for timeout tests
10. **Memory**: Monitor memory usage in large file tests

---

## Dependencies to Mock

- `worker_threads` (Worker, parentPort)
- `aws-sdk` (S3, Upload class)
- `crypto` (createHash)
- `stream` (Transform, pipeline)
- `https/http` (for download)
- EventEmitter (for PoolManager)

---

## Test Execution Commands

```bash
# Run all worker pool tests
npm run test:unit test/unit/worker-pool

# Run specific test file
npm run test:unit test/unit/worker-pool/pool-manager.service.spec.ts

# Run with coverage
npm run test:unit -- --coverage test/unit/worker-pool

# Run in watch mode
npm run test:unit -- --watch test/unit/worker-pool
```
