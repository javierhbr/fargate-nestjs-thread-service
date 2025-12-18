# Clinic.js Setup Summary

Clinic.js has been successfully configured to detect blocking operations in the SQS-based microservice and worker thread pool.

## What Was Installed

### Dependencies
- **clinic** (v13.0.0) - Performance profiling suite
- **autocannon** (v8.0.0) - HTTP load testing tool (legacy, no longer used)

### NPM Scripts Added

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

### Files Created

1. **`scripts/clinic-load-test.js`**
   - Custom load testing script
   - Sends test messages to SQS queue
   - Triggers worker thread processing
   - Configurable message count

2. **`scripts/clinic-profile.sh`**
   - Automated profiling wrapper script
   - Combines profiler startup, load testing, and reporting
   - Single command for complete profiling workflow

3. **`scripts/monitor-queue.js`**
   - Real-time SQS queue monitoring
   - Displays queue depth, in-flight messages, processing rate
   - Color-coded metrics for quick status assessment

4. **`PERFORMANCE_TESTING.md`**
   - Comprehensive performance testing guide
   - How to use each Clinic.js tool
   - Interpreting results and reports
   - Common issues and solutions
   - Advanced testing scenarios

5. **`scripts/README.md`**
   - Quick reference for scripts
   - Usage examples
   - Environment variables

6. **`.gitignore` updates**
   - Ignores Clinic.js output files
   - Prevents committing profiling reports

## Quick Start Guide

### Architecture Note

This application is now a **SQS-based microservice** (not an HTTP server). It consumes messages from SQS queues and processes them using worker threads. Profiling requires:

1. Starting the profiler with the app
2. Sending test messages to SQS queues
3. Stopping the profiler to generate reports

### Option 1: Automated Profiling (Recommended)

Use the wrapper script for one-command profiling:

```bash
# Build the application
npm run build

# Run profiling with 100 test messages
./scripts/clinic-profile.sh doctor 100

# Other tools
./scripts/clinic-profile.sh bubble 50
./scripts/clinic-profile.sh flame 200
./scripts/clinic-profile.sh heap 100
```

The script automatically:
- Starts the profiler
- Waits for app initialization
- Sends test messages
- Waits for processing
- Stops profiler and generates report

### Option 2: Manual Two-Terminal Workflow

For more control over timing:

```bash
# Terminal 1: Start profiling
npm run build
npm run clinic:doctor

# Wait ~5 seconds for app initialization
# Look for: "Export Processing Microservice started - listening to SQS queues"

# Terminal 2: Send test messages
npm run clinic:load 100

# Terminal 3 (Optional): Monitor queue in real-time
npm run clinic:monitor

# Terminal 1: After processing completes, press Ctrl+C
# Report will automatically open
```

### Option 3: Queue Monitoring During Profiling

Monitor SQS queues in real-time:

```bash
# Terminal 1: Start profiler
npm run clinic:doctor

# Terminal 2: Start queue monitor
npm run clinic:monitor

# Terminal 3: Send load
npm run clinic:load 100

# Watch Terminal 2 for real-time metrics:
# - Queue depth
# - In-flight messages
# - Processing rate
```

## What Each Tool Does

### Clinic Doctor 🩺
**Purpose:** Detect event loop blocking

**When to use:**
- Suspect main thread is blocked
- Application feels sluggish
- Message processing is slow

**What to look for:**
- 🟢 Green zones = Healthy (< 10ms delays)
- 🟡 Yellow zones = Warning (10-100ms delays)
- 🔴 Red zones = **BLOCKING DETECTED** (> 100ms delays)

**Common causes if blocking detected:**
- Synchronous file operations
- Heavy JSON parsing
- Crypto operations in main thread
- SQS message processing blocking the event loop

### Clinic Bubbleprof 🫧
**Purpose:** Analyze async operations

**When to use:**
- Understanding async flow
- Identifying slow operations
- Optimizing parallelism

**What to look for:**
- Large bubbles = Slow operations
- Long chains = Sequential bottlenecks
- Wide spread = Good parallelism

### Clinic Flame 🔥
**Purpose:** CPU profiling

**When to use:**
- High CPU usage
- Identifying hot code paths
- Optimizing algorithms

**What to look for:**
- Wide sections = CPU-intensive functions
- Optimize widest sections first
- Check for unexpected functions

### Clinic Heap Profiler 💾
**Purpose:** Memory leak detection

**When to use:**
- Memory usage growing
- Out of memory errors
- Container restarts

**What to look for:**
- Sawtooth pattern = Healthy (allocate → GC → repeat)
- Continuous growth = **MEMORY LEAK**
- Large allocations = Check object sizes

## Testing Scenarios

### Scenario 1: Verify Worker Threads Don't Block Main Thread

**Expected Result:** Green graph throughout test

```bash
# Automated
./scripts/clinic-profile.sh doctor 100

# Or manual
clinic doctor -- node dist/main.js
# Wait for startup, then:
npm run clinic:load 100
```

If red zones appear:
1. Check main thread is using async/await
2. Verify no synchronous file operations
3. Ensure SQS message parsing is async
4. Move heavy computation to workers

### Scenario 2: Verify Worker Pool Scalability

**Expected Result:** Higher throughput with more workers

```bash
# Test 1: 2 workers
WORKER_POOL_SIZE=2 ./scripts/clinic-profile.sh doctor 50

# Test 2: 8 workers
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 50

# Compare processing time and throughput
```

Throughput should scale linearly with CPU cores (up to I/O limits).

### Scenario 3: Stress Test Under Heavy Load

**Expected Result:** No event loop blocking even under stress

```bash
WORKER_POOL_SIZE=4 MAX_CONCURRENT_JOBS=20 ./scripts/clinic-profile.sh doctor 500
```

Monitor (in separate terminal):
```bash
npm run clinic:monitor
```

Watch for:
- Event loop delays (should stay green)
- Queue depth (should drain steadily)
- Worker restart rate (should be 0)

### Scenario 4: Memory Leak Detection

**Expected Result:** Sawtooth memory pattern

```bash
# Terminal 1: Start heap profiler
clinic heapprofiler -- node dist/main.js

# Terminal 2: Send sustained load
for i in {1..10}; do
  npm run clinic:load 50
  sleep 30
done

# Terminal 1: Press Ctrl+C after 5+ minutes
# Report will show memory allocation patterns
```

## Interpreting Results

### ✅ Good Results

**Clinic Doctor:**
- All green zones
- Event loop delays < 10ms
- CPU 60-90% utilized
- No spikes or red zones

**Clinic Bubble:**
- Small, distributed bubbles
- Multiple parallel operations
- Short async chains

**Clinic Flame:**
- Even CPU distribution
- No single function > 50%
- Worker operations visible

**Clinic Heap:**
- Sawtooth memory pattern
- Memory returns to baseline
- No continuous growth

### ❌ Issues to Fix

**Blocking Detected (Red Zones):**
```
Root Cause: Synchronous operations in main thread
Solution: Move to worker threads or use async/await
```

**High Queue Depth:**
```
Root Cause: Too few workers for load
Solution: Increase WORKER_POOL_SIZE
```

**Memory Leak:**
```
Root Cause: Objects not garbage collected
Solution: Fix leaks, check event listeners, verify cleanup
```

**High CPU in Single Function:**
```
Root Cause: Algorithm inefficiency
Solution: Optimize hot path, use better algorithm
```

## Next Steps

1. **Baseline Performance:**
   ```bash
   # Run all four tools with typical load
   ./scripts/clinic-profile.sh doctor 100
   ./scripts/clinic-profile.sh bubble 100
   ./scripts/clinic-profile.sh flame 100
   ./scripts/clinic-profile.sh heap 100
   ```

2. **Save Reports:**
   - Archive baseline reports
   - Compare after optimizations
   - Document findings

3. **Monitor in Development:**
   - Run before merging PRs
   - Profile after major changes
   - Catch regressions early

4. **Production Monitoring:**
   - Use APM tools (New Relic, Datadog)
   - Set up CloudWatch metrics
   - Alert on anomalies

## Troubleshooting

### "No data collected"
**Solution:** Ensure application starts successfully; check logs for errors

### "ECONNREFUSED" in load test
**Solution:** Verify LocalStack is running (`docker-compose ps`)

### Worker threads not in flame graph
**Solution:** Worker threads run in separate isolates; focus on main thread overhead

### Reports won't open
**Solution:** Check HTML files in current directory, open manually in browser

### Queue metrics not showing
**Solution:** Verify SQS queue URLs in environment variables

## Environment Variables

Required for profiling with LocalStack:

```bash
export AWS_ENDPOINT=http://localhost:4566
export SQS_EXPORT_JOBS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

## Resources

- Full Guide: [PERFORMANCE_TESTING.md](PERFORMANCE_TESTING.md)
- Script Reference: [scripts/README.md](scripts/README.md)
- Clinic.js Docs: https://clinicjs.org/
- Worker Threads: https://nodejs.org/api/worker_threads.html
- @ssut/nestjs-sqs: https://github.com/ssut/nestjs-sqs

## Success Criteria

Your SQS microservice and worker thread pool are performing well if:

✅ Clinic Doctor shows all green zones
✅ Event loop delays stay under 10ms
✅ Worker pool processes messages in parallel
✅ No memory leaks detected
✅ Throughput scales with worker count
✅ CPU utilization is 60-90% under load
✅ No blocking operations in main thread
✅ Worker crashes are handled gracefully
✅ SQS queue drains at steady rate
✅ No message backlog during normal load

---

**Ready to test?** Run: `./scripts/clinic-profile.sh doctor 100`
