# Scripts Directory

## Available Scripts

### Performance Testing

#### `clinic-load-test.js`
Load testing script that sends test messages to SQS to trigger worker thread processing.

**Usage:**
```bash
# Send 20 messages (default)
node scripts/clinic-load-test.js

# Send custom number of messages
node scripts/clinic-load-test.js 100

# With custom queue URL
SQS_EXPORT_JOBS_URL=http://... node scripts/clinic-load-test.js 50
```

**What it does:**
1. Generates realistic export job messages with UUIDs
2. Sends messages to SQS queue with configurable rate
3. Each message triggers worker thread processing
4. Simulates file downloads with 2-second delays
5. Exercises the complete worker pool pipeline

**Use cases:**
- Load testing the worker pool
- Performance profiling with Clinic.js
- Testing worker thread isolation
- Verifying message processing throughput
- Stress testing the system

**Environment variables:**
- `AWS_ENDPOINT` - LocalStack endpoint (default: http://localhost:4566)
- `SQS_EXPORT_JOBS_URL` - SQS queue URL
- `AWS_ACCESS_KEY_ID` - AWS credentials (default: test)
- `AWS_SECRET_ACCESS_KEY` - AWS credentials (default: test)

## Quick Reference

### Test for Event Loop Blocking
```bash
# Terminal 1: Start with profiling
npm run build
clinic doctor -- node dist/main.js

# Terminal 2: Send load
node scripts/clinic-load-test.js 50

# Terminal 1: Press Ctrl+C to generate report
```

### Test Worker Pool Scalability
```bash
# Test with 2 workers
WORKER_POOL_SIZE=2 clinic doctor -- node dist/main.js
# In another terminal:
node scripts/clinic-load-test.js 20

# Test with 8 workers
WORKER_POOL_SIZE=8 clinic doctor -- node dist/main.js
# In another terminal:
node scripts/clinic-load-test.js 100
```

### Memory Leak Detection
```bash
# Start heap profiler
clinic heapprofiler -- node dist/main.js

# Send waves of messages
for i in {1..10}; do
  node scripts/clinic-load-test.js 50
  sleep 30
done

# Press Ctrl+C to generate report
```

## Adding New Scripts

When adding new scripts to this directory:

1. **Use shebang:**
   ```javascript
   #!/usr/bin/env node
   ```

2. **Add JSDoc comments:**
   ```javascript
   /**
    * Script description
    *
    * Usage:
    *   node scripts/my-script.js [args]
    */
   ```

3. **Make executable:**
   ```bash
   chmod +x scripts/my-script.js
   ```

4. **Document here:**
   Add section to this README explaining the script

5. **Add to package.json (if npm script):**
   ```json
   "scripts": {
     "my-script": "node scripts/my-script.js"
   }
   ```
