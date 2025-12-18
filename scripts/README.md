# Scripts Directory

## Available Scripts

### Performance Testing & Profiling

#### `clinic-profile.sh`
Automated profiling wrapper that combines Clinic.js profiling with SQS load testing.

**Usage:**
```bash
# Run with Clinic Doctor (event loop profiling)
./scripts/clinic-profile.sh doctor 100

# Run with other tools
./scripts/clinic-profile.sh bubble 50   # Async operations
./scripts/clinic-profile.sh flame 200   # CPU profiling
./scripts/clinic-profile.sh heap 100    # Memory profiling

# With clean data (clears DynamoDB + SQS first)
CLEAR_DATA=true ./scripts/clinic-profile.sh doctor 100

# With environment variables
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 500

# Skip DynamoDB setup (if already populated)
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh doctor 100

# Clean baseline (clear + setup fresh data)
CLEAR_DATA=true ./scripts/clinic-profile.sh doctor 100
```

**What it does:**

0. **(Optional)** Clears all existing data if `CLEAR_DATA=true` (DynamoDB + SQS queues)
1. Pre-populates DynamoDB with test job records (unless `SKIP_DYNAMODB_SETUP=true`)
2. Starts the specified Clinic.js profiler (doctor, bubble, flame, heap)
3. Waits for microservice initialization (configurable delay)
4. Sends specified number of test messages to SQS
5. Waits for message processing to complete
6. Stops profiler and generates HTML report
7. Opens report in browser automatically

**Parameters:**
- `$1` - Tool name: `doctor`, `bubble`, `flame`, or `heap` (required)
- `$2` - Message count (default: 100)

**Environment variables:**
- `CLEAR_DATA` - Clear all data before profiling (default: false). **Use for clean baseline runs**
- `SKIP_DYNAMODB_SETUP` - Skip DynamoDB pre-population (default: false). **Use for CPU/memory iterations**
- `WORKER_POOL_SIZE` - Number of worker threads (default: 4)
- `STARTUP_WAIT` - Seconds to wait for app startup (default: 5)
- `PROCESSING_WAIT` - Seconds to wait after sending messages (default: 10)

**Use cases:**
- Quick one-command profiling workflow
- Automated performance regression testing
- CI/CD integration
- Consistent profiling methodology

#### `clinic-setup-dynamodb.js`

Pre-populates DynamoDB with test job records to prevent conditional check failures during profiling.

**Usage:**

```bash
# Setup for 100 jobs (default)
node scripts/clinic-setup-dynamodb.js 100

# Setup for custom number
node scripts/clinic-setup-dynamodb.js 500

# Run standalone before manual profiling
node scripts/clinic-setup-dynamodb.js 100
npm run clinic:doctor
```

**What it does:**

1. Generates realistic job records with UUIDs, statuses, and task data
2. Writes jobs to DynamoDB in batches (25 per batch)
3. Creates jobs in PENDING status that the application can update
4. Saves job IDs to `.clinic-jobs.json` for reference
5. Verifies table existence before writing

**Job structure:**

```javascript
{
  jobId: '<uuid>',
  exportId: '<uuid>',
  userId: 'test-user-<N>',
  status: 'PENDING',
  tasks: [{ taskId, url, format, outputKey, status }],
  retryCount: 0,
  version: 1,
  createdAt: '<iso-date>',
  updatedAt: '<iso-date>'
}
```

**Use cases:**

- Clean profiling without DynamoDB errors
- Pre-populating test data before load testing
- Ensuring database records exist for SQS messages
- Testing optimistic locking and conditional updates

**Environment variables:**
- `AWS_ENDPOINT` - LocalStack endpoint (default: http://localhost:4566)
- `DYNAMODB_TABLE_NAME` - Table name (default: export-job-state)
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID` - AWS credentials (default: test)
- `AWS_SECRET_ACCESS_KEY` - AWS credentials (default: test)

**Note:** This script is automatically run by `clinic-profile.sh` unless `SKIP_DYNAMODB_SETUP=true` is set.

#### `clinic-load-test.js`
Load testing script that sends test messages to SQS to trigger worker thread processing.

**Usage:**
```bash
# Send 20 messages (default)
node scripts/clinic-load-test.js

# Send custom number of messages
node scripts/clinic-load-test.js 100

# With npm script
npm run clinic:load 50

# With custom queue URL
SQS_EXPORT_JOBS_URL=http://... node scripts/clinic-load-test.js 50
```

**What it does:**
1. Generates realistic export job messages with UUIDs
2. Sends messages to SQS queue with configurable rate (100ms delay between messages)
3. Each message triggers worker thread processing
4. Simulates file downloads with 2-second delays via httpbin.org
5. Exercises the complete worker pool pipeline

**Message structure:**
```javascript
{
  jobId: '<uuid>',
  exportId: '<uuid>',
  userId: 'test-user-<random>',
  taskToken: '<uuid>',  // For Step Functions integration
  tasks: [
    {
      taskId: '<uuid>',
      downloadUrl: 'https://httpbin.org/delay/2',
      fileName: 'test-file-<N>.json',
      outputKey: 'exports/<jobId>/test-file-<N>.json'
    }
  ]
}
```

**Use cases:**
- Load testing the worker pool
- Performance profiling with Clinic.js
- Testing worker thread isolation
- Verifying message processing throughput
- Stress testing the SQS consumer
- Testing Step Functions integration

**Environment variables:**
- `AWS_ENDPOINT` - LocalStack endpoint (default: http://localhost:4566)
- `SQS_EXPORT_JOBS_URL` - SQS queue URL (default: http://sqs.us-east-1.localhost:4566/000000000000/export-jobs)
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID` - AWS credentials (default: test)
- `AWS_SECRET_ACCESS_KEY` - AWS credentials (default: test)

#### `monitor-queue.js`
Real-time SQS queue monitoring script for observing message processing during profiling.

**Usage:**
```bash
# Monitor with default 2-second polling
node scripts/monitor-queue.js

# Monitor with custom polling interval (1 second)
node scripts/monitor-queue.js 1000

# With npm script
npm run clinic:monitor
```

**What it does:**
1. Polls SQS queue attributes every 2 seconds (configurable)
2. Displays real-time metrics:
   - Visible messages (available for processing)
   - In-flight messages (currently being processed)
   - Delayed messages (with delay timer)
   - Total messages in queue
   - Processing rate (messages/second)
3. Color-codes metrics based on thresholds:
   - 🟢 Green: Healthy levels
   - 🟡 Yellow: Warning thresholds
   - 🔴 Red: Critical levels (queue backing up)
4. Calculates processing rate by tracking queue depth changes

**Display example:**
```
╔════════════════════════════════════════════════════════════════════════════╗
║  SQS Queue Monitor - Real-time Metrics         [14:32:15]          ║
╚════════════════════════════════════════════════════════════════════════════╝

Queue                          Visible  In-Flight  Delayed   Total      Rate
────────────────────────────────────────────────────────────────────────────
export-jobs                         42         8        0      50  ↓  5.2/s
download-tasks                     120        24        0     144  ↓ 12.3/s
```

**Use cases:**
- Monitoring queue health during profiling
- Observing message processing throughput
- Detecting queue backlog issues
- Verifying backpressure handling
- Understanding message flow patterns

**Environment variables:**
- `AWS_ENDPOINT` - LocalStack endpoint (default: http://localhost:4566)
- `SQS_EXPORT_JOBS_URL` - Export jobs queue URL (required)
- `SQS_DOWNLOAD_TASKS_URL` - Download tasks queue URL (optional)
- `AWS_REGION` - AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID` - AWS credentials (default: test)
- `AWS_SECRET_ACCESS_KEY` - AWS credentials (default: test)

**Keyboard commands:**
- `Ctrl+C` - Stop monitoring

## Quick Reference

### Option 1: Automated Profiling (Recommended)

Single command for complete profiling workflow:

```bash
# Build and run profiling
npm run build
./scripts/clinic-profile.sh doctor 100
```

### Option 2: Manual Multi-Terminal Workflow

For more control over timing and monitoring:

```bash
# Terminal 1: Start profiler
npm run build
npm run clinic:doctor

# Terminal 2: Monitor queue (optional)
npm run clinic:monitor

# Terminal 3: Send load after ~5 seconds
npm run clinic:load 100

# Terminal 1: Press Ctrl+C when done
```

### Test Scenarios

#### Event Loop Blocking Detection
```bash
./scripts/clinic-profile.sh doctor 100
# Look for green zones (healthy) or red zones (blocking)
```

#### Worker Pool Scalability
```bash
# Test with different worker counts
WORKER_POOL_SIZE=2 ./scripts/clinic-profile.sh doctor 50
WORKER_POOL_SIZE=4 ./scripts/clinic-profile.sh doctor 50
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 50
# Compare throughput and processing time
```

#### Stress Testing
```bash
# High load with monitoring
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 500
# In another terminal:
npm run clinic:monitor
```

#### Memory Leak Detection
```bash
# Terminal 1: Start heap profiler
clinic heapprofiler -- node dist/main.js

# Terminal 2: Send sustained load
for i in {1..10}; do
  npm run clinic:load 50
  sleep 30
done

# Terminal 1: Press Ctrl+C to generate report
```

#### Async Operations Analysis
```bash
./scripts/clinic-profile.sh bubble 100
# Analyze async flow and identify bottlenecks
```

#### CPU Profiling
```bash
./scripts/clinic-profile.sh flame 200
# Identify hot code paths and CPU-intensive functions
```

## Environment Setup

### Profiling Environment (.env.clinic)

The repository includes a `.env.clinic` file optimized for profiling. This configuration:

- Uses `NODE_ENV=production` for cleaner logs
- Sets `LOG_LEVEL=info` to reduce noise
- Uses `httpbin.org` for the Export API (always available, no local server needed)
- Reduces timeouts and retries for faster profiling
- Configurable worker pool size

**The script automatically loads `.env.clinic` if present, falling back to `.env` if not.**

To customize worker pool size for a specific profiling run:

```bash
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100
```

### Manual Environment Setup

For manual profiling or custom configurations:

```bash
# Create .env file or add to shell profile
export AWS_ENDPOINT=http://localhost:4566
export SQS_EXPORT_JOBS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs
export SQS_DOWNLOAD_TASKS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/download-tasks
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test

# Worker pool configuration
export WORKER_POOL_SIZE=4
export MAX_CONCURRENT_JOBS=20
```

## NPM Scripts Integration

These scripts are integrated with npm scripts in `package.json`:

```json
{
  "clinic:doctor": "clinic doctor -- node dist/main.js",
  "clinic:bubble": "clinic bubbleprof -- node dist/main.js",
  "clinic:flame": "clinic flame -- node dist/main.js",
  "clinic:heap": "clinic heapprofiler -- node dist/main.js",
  "clinic:load": "node scripts/clinic-load-test.js",
  "clinic:monitor": "node scripts/monitor-queue.js"
}
```

**Usage:**
```bash
# Manual profiling
npm run clinic:doctor
npm run clinic:load 100

# Automated profiling (recommended)
./scripts/clinic-profile.sh doctor 100

# Queue monitoring
npm run clinic:monitor
```

## Adding New Scripts

When adding new scripts to this directory:

1. **Use shebang:**
   ```javascript
   #!/usr/bin/env node
   ```
   or for Bash:
   ```bash
   #!/bin/bash
   ```

2. **Add documentation header:**
   ```javascript
   /**
    * Script description
    *
    * Usage:
    *   node scripts/my-script.js [args]
    *
    * Environment Variables:
    *   VAR_NAME - Description
    */
   ```

3. **Make executable:**
   ```bash
   chmod +x scripts/my-script.js
   ```

4. **Document here:**
   Add section to this README explaining:
   - Purpose and use cases
   - Usage examples
   - Parameters and options
   - Environment variables
   - Expected output

5. **Add to package.json (if npm script):**
   ```json
   "scripts": {
     "my-script": "node scripts/my-script.js"
   }
   ```

6. **Test thoroughly:**
   - Test with default values
   - Test with custom parameters
   - Test error handling
   - Document expected behavior

## Troubleshooting

### Script won't execute
**Cause:** Missing execute permissions
**Solution:**
```bash
chmod +x scripts/<script-name>.sh
chmod +x scripts/<script-name>.js
```

### "ECONNREFUSED" errors
**Cause:** LocalStack not running
**Solution:**
```bash
# Check LocalStack
docker-compose ps

# Start LocalStack
docker-compose up -d

# Verify connectivity
aws --endpoint-url=http://localhost:4566 sqs list-queues
```

### Queue not found
**Cause:** Queue URL not configured or queue doesn't exist
**Solution:**
```bash
# Check environment variables
echo $SQS_EXPORT_JOBS_URL

# Create queue if needed (via LocalStack)
aws --endpoint-url=http://localhost:4566 sqs create-queue --queue-name export-jobs
```

### Monitor shows no data
**Cause:** Environment variables not set
**Solution:**
```bash
# Export required variables
export SQS_EXPORT_JOBS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs
export AWS_ENDPOINT=http://localhost:4566

# Test
npm run clinic:monitor
```

## Related Documentation

- [Clinic.js Setup Summary](../CLINIC_SETUP_SUMMARY.md) - Quick start guide
- [Performance Testing Guide](../PERFORMANCE_TESTING.md) - Comprehensive profiling guide
- [Clinic.js Documentation](https://clinicjs.org/) - Official docs
- [@ssut/nestjs-sqs](https://github.com/ssut/nestjs-sqs) - SQS library docs

## Script Maintenance

Keep scripts up to date:

1. **Review regularly:** Check scripts still work with current codebase
2. **Update dependencies:** When AWS SDK or Clinic.js versions change
3. **Improve documentation:** Add examples from real usage
4. **Add new scripts:** As new testing needs arise
5. **Remove obsolete scripts:** Clean up unused files

## Best Practices

1. **Always build first:**
   ```bash
   npm run build
   ```

2. **Use automated wrapper for consistency:**
   ```bash
   ./scripts/clinic-profile.sh doctor 100
   ```

3. **Monitor during profiling:**
   ```bash
   npm run clinic:monitor
   ```

4. **Save baseline reports:**
   ```bash
   mkdir -p .clinic-baselines
   mv .clinic-* .clinic-baselines/baseline-$(date +%Y%m%d)/
   ```

5. **Test with realistic loads:**
   ```bash
   # ❌ Too small
   ./scripts/clinic-profile.sh doctor 10

   # ✅ Realistic
   ./scripts/clinic-profile.sh doctor 100-500
   ```

6. **Document findings:**
   - Note performance characteristics
   - Track improvements over time
   - Share insights with team
