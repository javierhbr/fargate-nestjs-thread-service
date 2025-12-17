# Export Service - Hybrid NestJS + Fastify on AWS Fargate

A high-performance export processing service built with NestJS and Fastify, designed to run on AWS Fargate with LocalStack support for local development.

## Features

- **Hybrid Architecture**: NestJS framework with Fastify adapter for high performance
- **AWS Native**: Integrates with SQS, S3, and DynamoDB
- **Worker Pool**: Multi-threaded processing with worker threads
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
```

### Optional Variables

See [.env.example](.env.example) for all available configuration options.

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

## Performance

- **Fastify**: High-performance HTTP server
- **Worker Threads**: Parallel processing of download tasks
- **Streaming**: Large file handling with streams
- **Connection Pooling**: Optimized AWS SDK connections

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
