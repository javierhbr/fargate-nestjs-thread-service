# Export Service - Hybrid NestJS + Fastify on AWS Fargate

A high-performance export processing service built with NestJS and Fastify, designed to run on AWS Fargate with LocalStack support for local development.

## Features

- **Hybrid Architecture**: NestJS framework with Fastify adapter for high performance
- **AWS Native**: Integrates with SQS, S3, and DynamoDB
- **Worker Thread Pool**: Multi-threaded parallel processing with isolated V8 contexts
- **Observability**: Structured logging with Pino, health checks with Terminus
- **Resilient**: Dead Letter Queues, retry mechanisms, graceful shutdown
- **Type Safe**: Full TypeScript with Zod validation
- **Local Development**: LocalStack integration for offline development

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Export Service                          │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │   API Layer  │      │  Consumers   │                    │
│  │   (Fastify)  │      │   (SQS)      │                    │
│  └──────┬───────┘      └──────┬───────┘                    │
│         │                     │                             │
│         │   ┌─────────────────┴─────────────┐              │
│         │   │    Orchestration Layer        │              │
│         │   │  - Polling Service            │              │
│         │   │  - Job Dispatcher             │              │
│         │   └─────────────┬─────────────────┘              │
│         │                 │                                 │
│         │   ┌─────────────┴─────────────────┐              │
│         └───┤      Worker Pool Manager      │              │
│             │   (Multi-threaded Workers)    │              │
│             └─────────────┬─────────────────┘              │
│                           │                                 │
│         ┌─────────────────┴─────────────────┐              │
│         │         AWS Services               │              │
│         │  - S3 (Storage)                    │              │
│         │  - SQS (Queues)                    │              │
│         │  - DynamoDB (State)                │              │
│         └────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### Local Development (Recommended)

Use LocalStack to run all AWS services locally:

```bash
# 1. Start LocalStack
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.local .env

# 4. Start the application
npm run start:dev
```

For detailed local development setup, see [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

### Production Deployment

For AWS Fargate deployment:

```bash
# 1. Install dependencies
npm install

# 2. Build the application
npm run build

# 3. Configure environment
# Set environment variables in your Fargate task definition

# 4. Deploy to Fargate
# Use your preferred deployment method (Terraform, CDK, etc.)
```

## Environment Variables

### Required Variables

```bash
# AWS Configuration
AWS_REGION=us-east-1

# SQS Queues
SQS_EXPORT_JOBS_URL=<your-export-jobs-queue-url>
SQS_DOWNLOAD_TASKS_URL=<your-download-tasks-queue-url>

# S3 Storage
S3_BUCKET_NAME=<your-bucket-name>

# Export API
EXPORT_API_BASE_URL=<your-export-api-url>

# Worker Pool (Critical for Performance)
WORKER_POOL_SIZE=4              # Number of worker threads
MAX_CONCURRENT_JOBS=20          # Max parallel jobs
TEMP_DIR=/tmp/exports           # Temp file storage
MAX_FILE_SIZE_MB=1024           # Max file size limit
```

### Worker Pool Configuration

The worker thread pool is the core of the service's parallel processing capability. Configure these variables carefully based on your infrastructure:

| Variable | Default | Description | Tuning Guidance |
|----------|---------|-------------|-----------------|
| `WORKER_POOL_SIZE` | `4` | Number of worker threads to spawn | Set to number of CPU cores, or cores - 1. More workers = higher throughput but more memory usage. |
| `MAX_CONCURRENT_JOBS` | `20` | Maximum jobs processed simultaneously | Should be 2-4x `WORKER_POOL_SIZE`. Acts as backpressure limit. |
| `TEMP_DIR` | `/tmp/exports` | Directory for temporary file storage | Must be writable. In Fargate, use `/tmp` (up to 20GB configurable). |
| `MAX_FILE_SIZE_MB` | `1024` | Maximum file size to process (MB) | Prevents memory/disk exhaustion. Files exceeding this are rejected. |

**Example Configurations:**

```bash
# Local Development (2 cores, 4GB RAM)
WORKER_POOL_SIZE=2
MAX_CONCURRENT_JOBS=5
MAX_FILE_SIZE_MB=512

# Production Small (2 vCPU, 4GB RAM)
WORKER_POOL_SIZE=4
MAX_CONCURRENT_JOBS=20
MAX_FILE_SIZE_MB=1024

# Production Large (4 vCPU, 8GB RAM)
WORKER_POOL_SIZE=8
MAX_CONCURRENT_JOBS=40
MAX_FILE_SIZE_MB=1024
```

### All Configuration Options

See [`.env.example`](.env.example) for complete list of available configuration options including:
- SQS polling settings (wait time, visibility timeout)
- DynamoDB table configuration
- Export API retry settings
- Orchestrator polling intervals
- Logging levels

## API Endpoints

### Health Check

```bash
GET /health
```

Returns service health status including AWS service connectivity.

## Project Structure

```
src/
├── config/                 # Configuration and validation
├── processing/            # Job processing logic
│   ├── consumers/        # SQS message consumers
│   └── services/         # Orchestration services
├── worker-pool/          # Worker thread management
│   └── threads/          # Worker thread implementations
├── shared/               # Shared utilities
│   ├── aws/             # AWS service clients
│   └── logging/         # Logging service
└── main.ts              # Application entry point
```

## Development

### Available Scripts

```bash
# Development
npm run start:dev        # Start with hot-reload
npm run start:debug      # Start with debugging

# Building
npm run build            # Build for production

# Testing
npm test                 # Run unit tests
npm run test:watch       # Run tests in watch mode
npm run test:cov         # Generate coverage report

# Code Quality
npm run lint             # Run ESLint
npm run format           # Format code with Prettier
```

### Running Tests

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## Monitoring

The service includes:

- **Structured Logging**: JSON logs with correlation IDs via Pino
- **Health Checks**: `/health` endpoint with detailed status
- **Metrics**: Worker pool stats, queue depths, processing times

## Error Handling

- **SQS Dead Letter Queues**: Failed messages moved to DLQ after 3 attempts
- **Graceful Shutdown**: Waits for in-flight tasks to complete
- **Retry Logic**: Configurable retry with exponential backoff
- **Error Tracking**: Errors logged with full context

## Worker Thread Pool Architecture

This service uses Node.js Worker Threads for CPU/IO-intensive file processing operations. Each worker runs in an isolated V8 context, enabling true parallel processing without blocking the main event loop.

### Thread Pool Design

```
Main Thread (Event Loop)
├── PoolManagerService
│   ├── Worker 0 (V8 Isolate) ──> Processing Task A
│   ├── Worker 1 (V8 Isolate) ──> Processing Task B
│   ├── Worker 2 (V8 Isolate) ──> Idle
│   └── Worker 3 (V8 Isolate) ──> Idle
│
├── Task Queue (FIFO)
│   ├── Task C (waiting)
│   ├── Task D (waiting)
│   └── Task E (waiting)
│
└── Message Passing (Structured Clone)
    ├── Main → Worker: PROCESS_TASK, HEALTH_CHECK, SHUTDOWN
    └── Worker → Main: TASK_COMPLETED, TASK_FAILED, HEALTH_RESPONSE
```

### Key Concepts

#### 1. **Worker Thread Isolation**
- Each worker runs in its own V8 isolate with separate heap (~1.5GB default)
- No shared memory between threads - prevents race conditions
- Communication via message passing (structured clone algorithm)
- Workers are long-lived processes, not spawned per-task

#### 2. **Pool Manager (`PoolManagerService`)**
- Manages a fixed-size pool of worker threads (configurable via `WORKER_POOL_SIZE`)
- Maintains a FIFO task queue for backpressure management
- Uses round-robin algorithm to distribute tasks across idle workers
- Automatically respawns crashed workers to maintain pool size
- Tracks metrics: completed tasks, failed tasks, processing time

#### 3. **Message Protocol**
All communication follows a strict message protocol:

**Main Thread → Worker:**
- `PROCESS_TASK`: Dispatch download task with URL, format, config
- `HEALTH_CHECK`: Request memory usage and uptime metrics
- `SHUTDOWN`: Request graceful worker termination

**Worker → Main Thread:**
- `TASK_COMPLETED`: Report success with output S3 key and size
- `TASK_FAILED`: Report failure with error code and retry guidance
- `HEALTH_RESPONSE`: Reply with memory metrics and uptime

#### 4. **Task Processing Flow**

```
1. SQS Consumer receives export job message
2. Job dispatched to PoolManager.submitTask()
3. PoolManager finds idle worker (round-robin)
   ├─ If worker available: dispatch immediately
   └─ If all busy: add to queue
4. Worker receives PROCESS_TASK message
5. Worker downloads file from URL
6. Worker applies format transformation
7. Worker uploads result to S3
8. Worker sends TASK_COMPLETED message
9. PoolManager resolves Promise
10. Main thread marks worker as idle
11. PoolManager checks queue for next task
```

#### 5. **Error Handling & Recovery**

**Task-Level Errors:**
- Network failures, validation errors → `TASK_FAILED` message with `retryable: true/false`
- Main thread handles error, may retry via SQS visibility timeout
- Failed tasks sent to Dead Letter Queue after 3 attempts

**Worker-Level Errors:**
- Uncaught exceptions → Worker exits with code 1
- PoolManager detects exit, spawns replacement worker
- In-progress task fails via SQS visibility timeout (auto-retry)
- Maintains pool size automatically

#### 6. **Memory Management**

Each worker has isolated memory:
- **Heap isolation**: Workers can't leak memory to each other
- **Health checks**: PoolManager periodically queries worker memory usage
- **Automatic cleanup**: Worker crash/restart clears corrupted memory
- **Limits**: `MAX_FILE_SIZE_MB` prevents individual tasks from exhausting memory

### Configuration Guide

#### Worker Pool Settings

Configure via environment variables in `.env`:

```bash
# Number of worker threads (default: 4)
# Recommendation: Number of CPU cores, or cores - 1
WORKER_POOL_SIZE=4

# Maximum concurrent jobs (default: 20)
# Acts as backpressure limit
# Recommendation: 2-4x WORKER_POOL_SIZE
MAX_CONCURRENT_JOBS=20

# Temporary directory for file downloads (default: /tmp/exports)
TEMP_DIR=/tmp/exports

# Maximum file size in MB (default: 1024)
# Files exceeding this fail with VALIDATION_ERROR
MAX_FILE_SIZE_MB=1024
```

#### Tuning Recommendations

**Memory-Constrained (< 2GB RAM):**
```bash
WORKER_POOL_SIZE=2
MAX_CONCURRENT_JOBS=4
MAX_FILE_SIZE_MB=256
```

**Balanced Production (4GB RAM, 2 vCPU):**
```bash
WORKER_POOL_SIZE=4
MAX_CONCURRENT_JOBS=20
MAX_FILE_SIZE_MB=1024
```

**High-Throughput (8GB RAM, 4 vCPU):**
```bash
WORKER_POOL_SIZE=8
MAX_CONCURRENT_JOBS=40
MAX_FILE_SIZE_MB=1024
```

**Local Development:**
```bash
WORKER_POOL_SIZE=2
MAX_CONCURRENT_JOBS=5
MAX_FILE_SIZE_MB=512
```

### Performance Characteristics

- **Throughput**: Scales linearly with CPU cores (up to I/O limits)
- **Latency**: ~50-200ms overhead for message passing per task
- **Memory**: ~100-200MB base + (workers × task memory footprint)
- **CPU**: Near 100% utilization during heavy load (desired behavior)

### Monitoring Worker Health

The service exposes worker pool metrics via `/health` endpoint:

```json
{
  "status": "ok",
  "info": {
    "workerPool": {
      "status": "up",
      "poolSize": 4,
      "activeWorkers": 2,
      "queuedTasks": 3,
      "completedTasks": 1247,
      "failedTasks": 12,
      "avgProcessingTimeMs": 3421
    }
  }
}
```

**Key metrics to monitor:**
- `queuedTasks`: High values indicate backpressure (consider increasing pool size)
- `failedTasks`: High ratio suggests issues with source data or network
- `avgProcessingTimeMs`: Increasing trend may indicate memory leaks or degraded performance

### Thread Safety Guarantees

1. **No shared state**: Workers cannot access each other's memory
2. **Message passing only**: All communication via structured cloning (deep copy)
3. **Event loop serialization**: Each worker processes one message at a time
4. **Atomic operations**: Pool manager state changes are synchronous
5. **No locking needed**: V8 isolates provide natural isolation

### Advanced Configuration

For advanced use cases, see detailed documentation in:
- [`src/worker-pool/pool-manager.service.ts`](src/worker-pool/pool-manager.service.ts) - Pool management logic
- [`src/worker-pool/threads/worker-thread.ts`](src/worker-pool/threads/worker-thread.ts) - Worker implementation
- [`src/worker-pool/interfaces/worker-message.interface.ts`](src/worker-pool/interfaces/worker-message.interface.ts) - Message protocol
- [`src/config/configuration.ts`](src/config/configuration.ts) - Configuration structure

## Performance

- **Fastify**: High-performance HTTP server (2-3x faster than Express)
- **Worker Threads**: True parallel processing across CPU cores
- **Streaming**: Large file handling with streams (no memory buffering)
- **Connection Pooling**: Optimized AWS SDK connections
- **Round-Robin Load Balancing**: Even task distribution across workers

## AWS Services

### SQS
- **export-jobs**: Main job queue
- **download-tasks**: Task distribution queue
- **DLQs**: Dead letter queues for failed messages

### S3
- **Output Storage**: Processed export files
- **Versioning**: Enabled for data protection

### DynamoDB
- **Job State**: Tracking export job progress
- **GSI**: Query by exportId for status lookups

## License

MIT

## Support

For issues and questions, please open an issue in the repository.
