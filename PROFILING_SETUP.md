# Clinic.js Profiling Setup - Complete Guide

This document explains the complete profiling setup created for clean, reliable performance profiling with Clinic.js.

## Quick Start

```bash
# One command to run complete profiling workflow:
./scripts/clinic-profile.sh doctor 100

# That's it! The script handles everything:
# 1. Loads .env.clinic configuration
# 2. Pre-populates DynamoDB with test data
# 3. Builds the application
# 4. Starts profiling
# 5. Sends test messages
# 6. Generates HTML report
```

## What Was Fixed

### 1. NestJS Module Dependencies ✅

**Problem:** Multiple modules had services that depended on `ConfigService` but didn't import `ConfigModule`.

**Fixed Modules:**
- [LoggingModule](src/shared/logging/logging.module.ts)
- [SqsModule](src/shared/aws/sqs/sqs.module.ts)
- [S3Module](src/shared/aws/s3/s3.module.ts)
- [DynamoDbModule](src/shared/aws/dynamodb/dynamodb.module.ts)
- [StepFunctionsModule](src/shared/aws/step-functions/step-functions.module.ts)
- [WorkerPoolModule](src/worker-pool/worker-pool.module.ts)
- [ProcessingModule](src/processing/processing.module.ts)

**Solution:** Added `ConfigModule` imports to all modules and ensured they import the custom config module from `src/config/config.module.ts` (not `@nestjs/config`).

### 2. Profiling Script Path ✅

**Problem:** Script was looking for `dist/main.js` but NestJS builds to `dist/src/main.js`.

**Solution:** Updated [clinic-profile.sh](scripts/clinic-profile.sh) to use correct path.

### 3. External API Dependencies ✅

**Problem:** Profiling failed because the Export API at `http://localhost:8080` didn't exist, causing HTTP timeouts.

**Solution:** Created [.env.clinic](.env.clinic) that uses `https://httpbin.org` for testing - always available, no local server needed.

### 4. DynamoDB Conditional Check Failures ✅

**Problem:** Load test creates jobs with random UUIDs, but DynamoDB doesn't have corresponding records, causing "conditional request failed" errors.

**Solution:** Created [clinic-setup-dynamodb.js](scripts/clinic-setup-dynamodb.js) that pre-populates DynamoDB with test job records before profiling.

## Components

### `.env.clinic` - Profiling Environment

Optimized configuration for clean profiling:

```bash
NODE_ENV=production          # Less verbose logging
LOG_LEVEL=info              # Balanced visibility
EXPORT_API_BASE_URL=https://httpbin.org  # Always available
EXPORT_API_TIMEOUT=10000    # Faster timeouts
EXPORT_API_MAX_RETRIES=1    # Quick failures
WORKER_POOL_SIZE=4          # Good default
SQS_WAIT_TIME_SECONDS=5     # Faster polling
```

**Key Benefits:**
- No external server dependencies
- Reduced log noise
- Faster failure recovery
- Configurable parallelism

### `clinic-setup-dynamodb.js` - Test Data Setup

Pre-populates DynamoDB with realistic job records:

```javascript
{
  jobId: '<uuid>',
  exportId: '<uuid>',
  userId: 'test-user-N',
  status: 'PENDING',
  tasks: [...],
  retryCount: 0,
  version: 1,
  createdAt: '...',
  updatedAt: '...'
}
```

**Features:**
- Batch writes (25 jobs per batch)
- Table existence verification
- Progress reporting
- Exports job IDs to `.clinic-jobs.json`

### `clinic-profile.sh` - Automated Profiling

Enhanced wrapper script with full automation:

**Workflow:**
1. **[Step 0]** Load `.env.clinic` if available
2. **[Step 0.5]** Setup DynamoDB test data
3. **[Step 1]** Start Clinic.js profiler
4. **[Step 2]** Wait for app initialization (5s)
5. **[Step 3]** Send test messages to SQS
6. **[Step 4]** Wait for processing (10s)
7. Stop profiler and generate report

## Usage Examples

### Basic Profiling

```bash
# Event loop analysis
./scripts/clinic-profile.sh doctor 100

# Async operations analysis
./scripts/clinic-profile.sh bubble 100

# CPU profiling
./scripts/clinic-profile.sh flame 100

# Memory profiling
./scripts/clinic-profile.sh heap 100
```

### Advanced Usage

```bash
# Test different worker pool sizes
WORKER_POOL_SIZE=2 ./scripts/clinic-profile.sh doctor 100
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100

# Skip DynamoDB setup (if already populated)
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh doctor 100

# High-load testing
./scripts/clinic-profile.sh flame 500

# Quick startup adjustment
STARTUP_WAIT=10 ./scripts/clinic-profile.sh doctor 100
```

### Manual Setup (Optional)

If you want more control:

```bash
# 1. Setup DynamoDB manually
node scripts/clinic-setup-dynamodb.js 100

# 2. Start profiling manually
npm run clinic:doctor

# 3. In another terminal: send load
npm run clinic:load 100

# 4. Stop profiling (Ctrl+C in profiler terminal)
```

## Environment Variables

### Profiling Script

- `STARTUP_WAIT` - Seconds to wait for app startup (default: 5)
- `PROCESSING_WAIT` - Seconds to wait after messages sent (default: 10)
- `SKIP_DYNAMODB_SETUP` - Set to `true` to skip DynamoDB setup
- `WORKER_POOL_SIZE` - Number of worker threads (default: 4)

### AWS/LocalStack

- `AWS_ENDPOINT` - LocalStack endpoint (default: http://localhost:4566)
- `AWS_REGION` - AWS region (default: us-east-1)
- `SQS_EXPORT_JOBS_URL` - Queue URL
- `DYNAMODB_TABLE_NAME` - Table name (default: export-job-state)

## Troubleshooting

### "Module not found" errors
**Cause:** Missing `ConfigModule` imports
**Status:** ✅ Fixed in all modules

### "Cannot find dist/main.js"
**Cause:** Wrong output path
**Status:** ✅ Fixed - now uses `dist/src/main.js`

### HTTP connection failures
**Cause:** Export API not running
**Status:** ✅ Fixed - `.env.clinic` uses httpbin.org

### "Conditional request failed" errors
**Cause:** Missing DynamoDB records
**Status:** ✅ Fixed - auto-setup with `clinic-setup-dynamodb.js`

### Bubbleprof shows empty report
**Possible causes:**
- Not enough async operations (use more messages: 200-500)
- Transpiled code (expected warning)
- Try flame profiler instead for CPU analysis

### LocalStack not running
```bash
# Start LocalStack
docker-compose up -d

# Verify
docker ps | grep localstack
```

## Performance Testing Scenarios

### Detect Event Loop Blocking
```bash
./scripts/clinic-profile.sh doctor 100
# Look for red zones in event loop delay chart
```

### Analyze Async Operations
```bash
./scripts/clinic-profile.sh bubble 200
# Explore async operation chains and delays
```

### Find CPU Hotspots
```bash
./scripts/clinic-profile.sh flame 200
# Identify expensive function calls
```

### Test Worker Pool Scalability
```bash
# Compare different pool sizes
for size in 2 4 8; do
  WORKER_POOL_SIZE=$size ./scripts/clinic-profile.sh doctor 100
done
```

### Stress Testing
```bash
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 500
# Monitor queue with: npm run clinic:monitor
```

## Files Created

- `.env.clinic` - Optimized profiling environment
- `scripts/clinic-setup-dynamodb.js` - DynamoDB pre-population
- `scripts/clinic-profile.sh` - Enhanced (auto-setup)
- `.clinic-jobs.json` - Generated job IDs (gitignored)
- `PROFILING_SETUP.md` - This guide

## Next Steps

1. **Run baseline profiling:**
   ```bash
   ./scripts/clinic-profile.sh doctor 100
   ```

2. **Save baseline reports:**
   ```bash
   mkdir -p .clinic-baselines
   mv .clinic-* .clinic-baselines/baseline-$(date +%Y%m%d)/
   ```

3. **Profile different scenarios:**
   - Different worker pool sizes
   - Various message counts
   - Different profiling tools

4. **Document findings:**
   - Note performance characteristics
   - Track improvements over time
   - Share insights with team

## References

- [Clinic.js Documentation](https://clinicjs.org/)
- [Scripts README](scripts/README.md)
- [Local Development Guide](LOCAL_DEVELOPMENT.md)
