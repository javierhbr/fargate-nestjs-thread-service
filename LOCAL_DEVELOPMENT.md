# Local Development Setup with LocalStack

This guide walks you through setting up the export service for local development using LocalStack to emulate AWS services.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20+ installed
- AWS CLI installed (optional, for manual testing)
- `awslocal` wrapper (optional, recommended for easier LocalStack interaction)

### Install awslocal (Optional but Recommended)

```bash
pip install awscli-local
```

## Quick Start

### 1. Start LocalStack

Start LocalStack and initialize AWS resources:

```bash
docker-compose up -d
```

This will:
- Start LocalStack container
- Automatically create S3 buckets, SQS queues, and DynamoDB tables
- Configure Dead Letter Queues (DLQs)

Check the logs to verify initialization:

```bash
docker-compose logs -f localstack
```

### 2. Configure Environment

Copy the LocalStack environment file:

```bash
cp .env.local .env
```

The `.env.local` file is pre-configured with LocalStack endpoints and test credentials.

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Application

```bash
npm run start:dev
```

The service will start on `http://localhost:3000` with hot-reload enabled.

## LocalStack Resources

The initialization script creates the following resources:

### SQS Queues
- **export-jobs** - Main queue for export job messages
  - URL: `http://localhost:4566/000000000000/export-jobs`
  - DLQ: `export-jobs-dlq` (max 3 receive attempts)

- **download-tasks** - Queue for download task messages
  - URL: `http://localhost:4566/000000000000/download-tasks`
  - DLQ: `download-tasks-dlq` (max 3 receive attempts)

### S3 Buckets
- **export-output-bucket** - Storage for export outputs
  - Versioning: Enabled
  - Prefix: `exports/`

### DynamoDB Tables
- **export-job-state** - Job state tracking
  - Partition Key: `jobId` (String)
  - GSI: `exportId-index` on `exportId`

## Testing with LocalStack

### Send a Test Message to SQS

Using awslocal (if installed):

```bash
awslocal sqs send-message \
  --queue-url http://sqs.us-east-1.localhost:4566/000000000000/export-jobs \
  --message-body '{
    "jobId": "test-job-123",
    "exportId": "export-456",
    "userId": "user-789",
    "tasks": [
      {
        "taskId": "task-1",
        "url": "https://httpbin.org/json",
        "format": "json"
      }
    ]
  }'
```

Using AWS CLI with endpoint:

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws sqs send-message \
  --endpoint-url http://localhost:4566 \
  --queue-url http://sqs.us-east-1.localhost:4566/000000000000/export-jobs \
  --message-body '{"jobId":"test-job-123","exportId":"export-456","userId":"user-789","createdAt":"2025-12-17T16:00:00Z","tasks":[{"taskId":"task-1","jobId":"test-job-123","url":"https://httpbin.org/json","format":"json","outputKey":"exports/test-job-123/task-1.json"}]}'
```

### List S3 Objects

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 s3 ls s3://export-output-bucket/exports/
```

### Query DynamoDB

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 dynamodb get-item \
  --table-name export-job-state \
  --key '{"jobId":{"S":"test-job-123"}}'
```

### Check Queue Messages

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 sqs receive-message \
  --queue-url http://sqs.us-east-1.localhost:4566/000000000000/export-jobs \
  --max-number-of-messages 10
```

## Health Check

Verify the application is running:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "info": {
    "sqs": { "status": "up" },
    "s3": { "status": "up" },
    "dynamodb": { "status": "up" }
  }
}
```

## Accessing LocalStack Dashboard

LocalStack provides a web UI (Pro version only):
- URL: `http://localhost:4566/_localstack/health`

For community edition, use AWS CLI commands with `--endpoint-url http://localhost:4566`

## Troubleshooting

### LocalStack not starting

Check Docker logs:
```bash
docker-compose logs localstack
```

Restart LocalStack:
```bash
docker-compose restart localstack
```

### Resources not created

Manually run the initialization script:
```bash
docker-compose exec localstack /etc/localstack/init/ready.d/01-setup-resources.sh
```

### Application can't connect to LocalStack

1. Verify LocalStack is running:
   ```bash
   docker-compose ps
   ```

2. Check endpoint configuration in `.env`:
   ```
   AWS_ENDPOINT=http://localhost:4566
   ```

3. Test connectivity:
   ```bash
   curl http://localhost:4566/_localstack/health
   ```

### Permission errors

Ensure you're using the test credentials:
```
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
```

## Stopping LocalStack

Stop the container but preserve data:
```bash
docker-compose stop
```

Stop and remove containers (data will be lost):
```bash
docker-compose down
```

Stop and remove volumes (complete cleanup):
```bash
docker-compose down -v
```

## Environment Variables

Key environment variables for LocalStack:

| Variable | Value | Description |
|----------|-------|-------------|
| `AWS_ENDPOINT` | `http://localhost:4566` | LocalStack endpoint |
| `AWS_ACCESS_KEY_ID` | `test` | Test credentials |
| `AWS_SECRET_ACCESS_KEY` | `test` | Test credentials |
| `AWS_REGION` | `us-east-1` | AWS region |
| `WORKER_POOL_SIZE` | `2` | Reduced for local dev |
| `MAX_CONCURRENT_JOBS` | `5` | Reduced for local dev |

## Mock Export API

The application requires an export API endpoint. For local testing, you can:

1. **Use a mock server** (recommended):
   ```bash
   # Install json-server globally
   npm install -g json-server

   # Create a mock API
   echo '{"exports": []}' > db.json
   json-server --watch db.json --port 8080
   ```

2. **Update EXPORT_API_BASE_URL** in `.env`:
   ```
   EXPORT_API_BASE_URL=http://localhost:8080
   ```

## Development Workflow

1. Start LocalStack: `docker-compose up -d`
2. Start mock API (if needed): `json-server --watch db.json --port 8080`
3. Start application: `npm run start:dev`
4. Send test messages to SQS queues
5. Monitor logs and verify processing
6. Check outputs in S3 and state in DynamoDB

## Additional Commands

### View all queues
```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 sqs list-queues
```

### View all S3 buckets
```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 s3 ls
```

### View DynamoDB tables
```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 dynamodb list-tables
```

### Purge a queue
```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 sqs purge-queue \
  --queue-url http://sqs.us-east-1.localhost:4566/000000000000/export-jobs
```

## Production vs Local Differences

| Feature | Production | Local (LocalStack) |
|---------|-----------|-------------------|
| AWS Endpoint | Default AWS | `http://localhost:4566` |
| Credentials | IAM Role/Keys | `test/test` |
| S3 Path Style | Virtual-hosted | Path-style (forced) |
| Worker Pool | 4 workers | 2 workers |
| Concurrent Jobs | 20 | 5 |

## Next Steps

- Review the main [README.md](README.md) for architecture details
- Check [src/](src/) for code structure
- Run tests: `npm test`
- Build for production: `npm run build`
