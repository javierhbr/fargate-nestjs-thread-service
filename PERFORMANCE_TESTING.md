# Performance Testing with Clinic.js

This guide explains how to use Clinic.js to detect blocking operations, memory leaks, and performance issues in the SQS-based microservice and worker thread pool.

## Overview

Clinic.js is a suite of Node.js performance profiling tools that help identify:
- **Event loop blocking** (Doctor)
- **Async operations delays** (Bubbleprof)
- **CPU bottlenecks** (Flame)
- **Memory leaks** (Heap Profiler)

## Architecture Context

This application is an **SQS-based microservice** (not an HTTP server):
- Consumes messages from SQS queues using `@ssut/nestjs-sqs`
- Processes tasks using worker threads
- No HTTP endpoints for health checks
- Requires manual load testing via SQS message injection

## Prerequisites

```bash
# Install dependencies (already done if you ran npm install)
npm install --save-dev clinic autocannon

# Ensure LocalStack is running
docker-compose up -d

# Build the application
npm run build
```

## Quick Start

### Option 1: Automated Profiling (Recommended)

Use the wrapper script for complete profiling workflow:

```bash
# Run Clinic Doctor with 100 test messages
./scripts/clinic-profile.sh doctor 100

# Other tools
./scripts/clinic-profile.sh bubble 50
./scripts/clinic-profile.sh flame 200
./scripts/clinic-profile.sh heap 100
```

### Option 2: Manual Two-Terminal Workflow

For more control over timing:

```bash
# Terminal 1: Start profiling
npm run clinic:doctor

# Terminal 2: Wait ~5s, then send load
npm run clinic:load 100

# Terminal 3 (Optional): Monitor queue
npm run clinic:monitor

# Terminal 1: Press Ctrl+C when done
```

## Detailed Tool Guides

### 1. Clinic Doctor (Detect Event Loop Blocking)

**Purpose:** Detects event loop delays and helps identify blocking operations in the main thread.

**When to use:**
- Suspect main thread is blocked by SQS message processing
- Message processing feels slow
- Want to verify worker threads aren't blocking main thread

**Command:**
```bash
# Automated
./scripts/clinic-profile.sh doctor 100

# Manual
npm run clinic:doctor
# In another terminal:
npm run clinic:load 100
```

**What to look for:**
- 🟢 **Green**: Healthy event loop (< 10ms delays)
- 🟡 **Yellow**: Moderate delays (10-100ms) - investigate
- 🔴 **Red**: Severe blocking (> 100ms) - **Action required!**

**Common causes if red zones detected:**
1. Synchronous SQS message parsing
2. Heavy JSON operations in main thread
3. Blocking database queries
4. Synchronous file I/O
5. CPU-intensive validation in message handlers

**How to fix:**
```typescript
// ❌ BAD: Blocking main thread
const data = JSON.parse(largeJsonString);  // Sync parsing

// ✅ GOOD: Async or move to worker
const data = await parseJsonAsync(largeJsonString);
// OR
const data = await workerPool.submit({ type: 'parse', data: largeJsonString });
```

### 2. Clinic Bubbleprof (Async Operations Analysis)

**Purpose:** Visualizes async operations and identifies slow async paths in message processing pipeline.

**When to use:**
- Understanding async flow of SQS message processing
- Identifying slow operations (DynamoDB, S3, Export API calls)
- Optimizing parallelism in task dispatching

**Command:**
```bash
./scripts/clinic-profile.sh bubble 100
```

**What to look for:**
- **Large bubbles**: Slow async operations
  - DynamoDB queries
  - S3 uploads
  - HTTP API calls
- **Long chains**: Sequential bottlenecks
  - Tasks waiting in queue
  - Sequential processing that could be parallel
- **Wide spreads**: Good parallelism
  - Worker threads processing in parallel
  - Concurrent SQS message handling

**Example interpretation:**
```
Large bubble at "DynamoDB.updateItem"
→ Database writes are slow
→ Solution: Batch updates or use DynamoDB batch write

Long chain: SQS → Parse → Validate → DynamoDB → Dispatch
→ Sequential processing
→ Solution: Parallelize validation and DynamoDB write
```

### 3. Clinic Flame (CPU Profiling)

**Purpose:** Shows CPU usage and identifies hot code paths consuming CPU time.

**When to use:**
- High CPU usage observed
- Identifying CPU-intensive message processing
- Optimizing algorithms and parsers

**Command:**
```bash
./scripts/clinic-profile.sh flame 200
```

**What to look for:**
- **Wide flame sections**: CPU-intensive functions
  - JSON parsing
  - Data validation
  - Message transformation
- **Unexpected functions**:
  - Should see minimal main thread CPU
  - Worker threads handle heavy lifting
- **Optimization targets**:
  - Functions using > 10% CPU
  - Hot paths in message handlers

**Example findings:**
```
validateDownloadTaskMessage() - 25% CPU
→ Validation logic is expensive
→ Solution: Use compiled validators (Zod, Joi) or simplify

JSON.parse() - 15% CPU
→ Large messages being parsed
→ Solution: Stream parsing or limit message size
```

### 4. Clinic Heap Profiler (Memory Leak Detection)

**Purpose:** Tracks memory allocations over time to detect leaks and excessive memory usage.

**When to use:**
- Memory usage growing over time
- Out of memory errors in production
- Container restarts due to memory limits
- Long-running profiling sessions

**Command:**
```bash
# Terminal 1: Start heap profiler
clinic heapprofiler -- node dist/main.js

# Terminal 2: Send sustained load
for i in {1..10}; do
  npm run clinic:load 50
  sleep 30
done

# Terminal 1: Press Ctrl+C after 5+ minutes
```

**What to look for:**
- **Sawtooth pattern**: ✅ Healthy
  - Memory allocates
  - Garbage collector runs
  - Memory returns to baseline
  - Pattern repeats

- **Continuous growth**: ❌ Memory leak
  - Memory never returns to baseline
  - Each cycle adds more memory
  - Will eventually crash

- **Large allocations**:
  - Check message payload sizes
  - Look for accumulating arrays/objects
  - Verify cleanup in error handlers

**Common memory leak causes:**
```typescript
// ❌ BAD: Event listeners not removed
sqsConsumer.on('message', handler);
// Handler keeps references, prevents GC

// ✅ GOOD: Clean up listeners
const controller = new AbortController();
sqsConsumer.on('message', handler, { signal: controller.signal });
// Later: controller.abort()

// ❌ BAD: Accumulating in-memory cache
const processedMessages = new Map();
// Never cleared, grows forever

// ✅ GOOD: LRU cache with size limit
const processedMessages = new LRUCache({ max: 1000 });
```

## Testing Worker Thread Pool Under Load

### Scenario 1: Verify No Main Thread Blocking

**Goal:** Ensure worker threads isolate CPU-intensive work from the main thread.

**Expected Result:** All green zones in Clinic Doctor, < 10ms event loop delays.

**Test:**
```bash
# Automated
./scripts/clinic-profile.sh doctor 100

# Manual approach
# Terminal 1
clinic doctor -- node dist/main.js

# Terminal 2 (wait for startup)
npm run clinic:load 100
```

**Success criteria:**
- ✅ Event loop delays < 10ms
- ✅ No red zones in report
- ✅ Consistent message processing rate
- ✅ CPU usage distributed across workers

**If test fails (red zones appear):**
1. Check `@SqsMessageHandler` methods for sync operations
2. Verify message parsing is async
3. Move validation to worker threads
4. Profile individual message handlers

### Scenario 2: Verify Worker Pool Scalability

**Goal:** Confirm throughput scales linearly with worker count.

**Test:**
```bash
# Test 1: 2 workers
WORKER_POOL_SIZE=2 ./scripts/clinic-profile.sh doctor 50

# Test 2: 4 workers
WORKER_POOL_SIZE=4 ./scripts/clinic-profile.sh doctor 50

# Test 3: 8 workers
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 50
```

**Measure:**
- Processing time for 50 messages
- Messages processed per second
- CPU utilization percentage

**Expected results:**
```
2 workers:  ~10 seconds, ~5 msg/s,  25% CPU
4 workers:  ~5 seconds,  ~10 msg/s, 50% CPU
8 workers:  ~2.5 seconds, ~20 msg/s, 100% CPU
```

**Success criteria:**
- ✅ Throughput doubles when workers double (up to CPU limit)
- ✅ Processing time halves with doubled workers
- ✅ CPU utilization scales proportionally
- ✅ No event loop blocking at any worker count

### Scenario 3: Stress Test Under Heavy Load

**Goal:** Verify system stability under high message volume.

**Test:**
```bash
# High load with many concurrent workers
WORKER_POOL_SIZE=8 MAX_CONCURRENT_JOBS=50 ./scripts/clinic-profile.sh doctor 500
```

**Monitor in separate terminal:**
```bash
npm run clinic:monitor
```

**Watch for:**
- Event loop delays (should stay green)
- Queue depth (should drain steadily)
- In-flight message count
- Worker crash rate (should be 0)
- Memory usage (should be stable)

**Success criteria:**
- ✅ Event loop < 10ms throughout test
- ✅ Queue drains at steady rate
- ✅ No worker crashes or restarts
- ✅ Memory returns to baseline after load
- ✅ All 500 messages processed successfully

**If test fails:**
- Queue depth keeps growing → Increase workers or optimize processing
- Event loop blocking → Move work to workers
- Workers crashing → Fix error handling in worker code
- Memory growing → Check for leaks in worker lifecycle

### Scenario 4: Memory Leak Detection Over Time

**Goal:** Verify no memory leaks in long-running scenarios.

**Test:**
```bash
# Terminal 1: Start heap profiler
clinic heapprofiler -- node dist/main.js

# Terminal 2: Send 10 batches with 30s intervals
for i in {1..10}; do
  echo "Batch $i of 10"
  npm run clinic:load 50
  sleep 30
done

# Wait total 5+ minutes, then Ctrl+C in Terminal 1
```

**Expected pattern:**
```
Memory (MB)
     100 |     /\      /\      /\      /\
      80 |    /  \    /  \    /  \    /  \
      60 |   /    \  /    \  /    \  /    \
      40 |  /      \/      \/      \/      \
      20 | /
       0 +------------------------------------ Time
           Sawtooth pattern = Healthy GC
```

**Success criteria:**
- ✅ Sawtooth memory pattern (allocate → GC → repeat)
- ✅ Memory baseline doesn't increase over time
- ✅ Peak memory stays consistent across batches
- ✅ GC runs regularly and effectively

**Red flags:**
- ❌ Memory continuously growing
- ❌ Baseline increases with each batch
- ❌ GC not reclaiming memory
- ❌ Heap size approaching limit

**If leak detected:**
1. Check Clinic Heap report for retention paths
2. Look for:
   - Event listeners not removed
   - Global caches without limits
   - Circular references
   - Resources not closed (DB connections, file handles)
3. Review error handling - leaks often occur in error paths

## Real-Time Queue Monitoring

The queue monitor script provides live visibility into SQS message flow:

```bash
npm run clinic:monitor
```

**Display:**
```
╔════════════════════════════════════════════════════════════════════════════╗
║  SQS Queue Monitor - Real-time Metrics         [14:32:15]          ║
╚════════════════════════════════════════════════════════════════════════════╝

Queue                          Visible  In-Flight  Delayed   Total      Rate
────────────────────────────────────────────────────────────────────────────
export-jobs                         42         8        0      50  ↓  5.2/s
download-tasks                     120        24        0     144  ↓ 12.3/s

Legend:
  Visible:   Messages available for processing
  In-Flight: Messages currently being processed
  Delayed:   Messages with delay timer
  Total:     Sum of all messages in queue
  Rate:      Messages/second (↓=processing, ↑=adding)
```

**Color coding:**
- 🟢 Green: Healthy levels
- 🟡 Yellow: Warning thresholds
- 🔴 Red: Critical levels (queue backing up)

**Use during profiling:**
1. Start profiler in Terminal 1
2. Start monitor in Terminal 2
3. Send load in Terminal 3
4. Watch queue drain rate and processing throughput

## Advanced Testing Scenarios

### Scenario 5: Concurrent Job Processing

**Test multiple export jobs processing simultaneously:**

```bash
# Terminal 1: Start profiler
WORKER_POOL_SIZE=8 MAX_CONCURRENT_JOBS=10 clinic doctor -- node dist/main.js

# Terminal 2: Monitor queues
npm run clinic:monitor

# Terminal 3: Send multiple batches quickly
for i in {1..5}; do
  npm run clinic:load 20 &
done
wait
```

**Expected:**
- Multiple jobs processing in parallel
- Worker pool shared across jobs
- Fair task distribution
- No job starvation

### Scenario 6: Error Handling Under Load

**Test system resilience when tasks fail:**

```bash
# Use modified load test with 20% failure rate
FAILURE_RATE=0.2 npm run clinic:load 100

# Or manually inject invalid messages
```

**Monitor:**
- Error handling doesn't block event loop
- Failed tasks retry appropriately
- DLQ receives failed messages
- Memory doesn't leak on errors

### Scenario 7: Pool Capacity Management

**Test overflow queue behavior when pool is full:**

```bash
# Small pool, high load
WORKER_POOL_SIZE=2 MAX_QUEUE_SIZE=5 ./scripts/clinic-profile.sh doctor 100
```

**Expected:**
- Tasks queue when pool is full
- Overflow to SQS download-tasks queue
- No message loss
- Backpressure handled gracefully

## Interpreting Clinic.js Reports

### Clinic Doctor Report

**Healthy System:**
```
Event Loop Delay
    10ms |
     8ms |
     6ms |  /\  /\ /\
     4ms | /  \/  V  \
     2ms |/           \
     0ms +──────────────── Time
         Green zone throughout
```

**Problematic System:**
```
Event Loop Delay
   200ms |      ██
   150ms |      ██
   100ms |    ████  ← RED ZONE
    50ms |   ██████
     0ms +──────────────── Time
         Blocking detected!
```

**Action items:**
- Find blocking operations in stack trace
- Move to worker threads or async implementation
- Check for synchronous I/O

### Clinic Bubbleprof Report

**Good async flow:**
- Many small bubbles (fast operations)
- Parallel execution visible
- Short critical paths

**Poor async flow:**
- Few large bubbles (slow operations)
- Long sequential chains
- Limited parallelism

**Optimization:**
```typescript
// ❌ Sequential (long chain)
await dynamodb.update(job1);
await dynamodb.update(job2);
await dynamodb.update(job3);

// ✅ Parallel (wide spread)
await Promise.all([
  dynamodb.update(job1),
  dynamodb.update(job2),
  dynamodb.update(job3),
]);
```

### Clinic Flame Report

**Identify hot paths:**
1. Look for wide horizontal sections
2. Trace up the stack to calling function
3. Optimize the widest sections first
4. Aim for even distribution

**Common hotspots in this codebase:**
- JSON parsing: Consider streaming parsers
- Validation: Use compiled validators
- Data transformation: Optimize algorithms
- DynamoDB queries: Batch operations

### Clinic Heap Report

**Healthy memory pattern:**
- Regular sawtooth pattern
- Consistent peak and baseline
- Efficient garbage collection
- No long-term growth

**Memory leak indicators:**
- Continuous upward trend
- Increasing baseline
- Growing number of objects
- Retention paths to unexpected objects

## Environment Variables for Testing

Control profiling behavior via environment:

```bash
# Worker pool configuration
WORKER_POOL_SIZE=4              # Number of worker threads
MAX_CONCURRENT_JOBS=20          # Concurrent jobs processing
MAX_QUEUE_SIZE=100              # Internal queue size

# SQS configuration (LocalStack)
AWS_ENDPOINT=http://localhost:4566
SQS_EXPORT_JOBS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs
SQS_DOWNLOAD_TASKS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/download-tasks

# AWS credentials (LocalStack)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# Profiling wrapper script
STARTUP_WAIT=5                  # Seconds to wait for app startup
PROCESSING_WAIT=10              # Seconds to wait for processing
```

## Performance Baselines

Record baseline metrics for comparison:

```bash
# Create baseline directory
mkdir -p .clinic-baselines

# Run baseline profiling
./scripts/clinic-profile.sh doctor 100
mv .clinic-doctor-* .clinic-baselines/baseline-doctor-$(date +%Y%m%d)

./scripts/clinic-profile.sh flame 100
mv .clinic-flame-* .clinic-baselines/baseline-flame-$(date +%Y%m%d)
```

**Track over time:**
- Event loop delays
- Processing time for standard load
- Memory usage
- CPU distribution
- Queue processing rate

**Compare after changes:**
- Before/after optimization
- Before/after scaling changes
- Before/after library updates

## Continuous Integration

Add profiling to CI pipeline:

```yaml
# .github/workflows/performance.yml
name: Performance Regression Tests

on:
  pull_request:
    branches: [main]

jobs:
  profile:
    runs-on: ubuntu-latest
    services:
      localstack:
        image: localstack/localstack
        ports:
          - 4566:4566
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm ci
      - run: npm run build
      - run: |
          # Run profiling
          ./scripts/clinic-profile.sh doctor 100

          # Check for event loop blocking
          # (Parse HTML report, fail if red zones detected)

      - uses: actions/upload-artifact@v2
        with:
          name: clinic-reports
          path: .clinic-*
```

## Troubleshooting

### "No data collected"
**Cause:** Application didn't start or crashed immediately
**Solution:**
- Check logs for startup errors
- Verify LocalStack is running
- Test application starts successfully: `npm run build && node dist/main.js`

### "ECONNREFUSED" in load test
**Cause:** LocalStack not running or wrong endpoint
**Solution:**
```bash
# Check LocalStack
docker-compose ps

# Test SQS connectivity
aws --endpoint-url=http://localhost:4566 sqs list-queues
```

### Worker threads not visible in Flame graph
**Cause:** Workers run in separate V8 isolates
**Solution:** This is expected. Focus on main thread overhead and worker communication.

### Reports won't open automatically
**Cause:** No default browser or permissions issue
**Solution:**
```bash
# Find HTML files
ls -la .clinic-*

# Open manually
open .clinic-doctor-*/clinic-doctor.html
```

### Queue metrics not showing
**Cause:** Environment variables not set
**Solution:**
```bash
# Export required variables
export SQS_EXPORT_JOBS_URL=http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs
export AWS_ENDPOINT=http://localhost:4566

# Test monitor
npm run clinic:monitor
```

### High memory usage in profiler
**Cause:** Clinic.js collects extensive data
**Solution:**
- Normal for profiling tools
- Use shorter profiling sessions
- Close other applications
- Consider profiling on larger instance

## Best Practices

### 1. Profile Early and Often
- Before optimizations (establish baseline)
- After major changes
- Before production deployments
- When performance degrades

### 2. Isolate What You're Testing
```bash
# Test specific scenarios
WORKER_POOL_SIZE=4 ./scripts/clinic-profile.sh doctor 50  # Worker scalability
FAILURE_RATE=0.2 ./scripts/clinic-profile.sh flame 100    # Error path CPU
MAX_QUEUE_SIZE=10 ./scripts/clinic-profile.sh bubble 200  # Backpressure handling
```

### 3. Use Multiple Tools
- Doctor: Event loop health
- Bubbleprof: Async bottlenecks
- Flame: CPU hot paths
- Heap: Memory leaks

Each provides different insights. Use all four for complete picture.

### 4. Profile Realistic Workloads
```bash
# Don't just test with 10 messages
./scripts/clinic-profile.sh doctor 10  # ❌ Too small

# Test with realistic volume
./scripts/clinic-profile.sh doctor 500  # ✅ Realistic
```

### 5. Monitor During Profiling
```bash
# Always use queue monitor to understand message flow
npm run clinic:monitor
```

### 6. Document Findings
- Save baseline reports
- Note performance characteristics
- Track improvements over time
- Share insights with team

### 7. Automate Regression Testing
- Add profiling to CI/CD
- Fail builds if blocking detected
- Track metrics over time
- Alert on performance degradation

## Success Criteria

Your SQS microservice and worker pool are performing well when:

✅ **Clinic Doctor:**
- All green zones (< 10ms event loop delays)
- No red zones under typical load
- Event loop unaffected by worker load

✅ **Clinic Bubbleprof:**
- Small, distributed async operations
- Parallel execution of tasks
- Short critical paths

✅ **Clinic Flame:**
- Even CPU distribution
- No single function dominating
- Worker threads handling heavy lifting

✅ **Clinic Heap:**
- Sawtooth memory pattern
- Memory returns to baseline
- No continuous growth
- Efficient garbage collection

✅ **Queue Metrics:**
- Steady processing rate
- Queue drains reliably
- No message backlog
- Appropriate in-flight count

✅ **Scalability:**
- Throughput scales with workers
- Linear performance improvement
- Efficient resource utilization

✅ **Stability:**
- No worker crashes
- Graceful error handling
- Resilient under load
- Predictable performance

## Next Steps

1. **Run Baseline Profiling:**
   ```bash
   ./scripts/clinic-profile.sh doctor 100
   ./scripts/clinic-profile.sh bubble 100
   ./scripts/clinic-profile.sh flame 100
   ./scripts/clinic-profile.sh heap 100
   ```

2. **Save Baseline Reports:**
   - Archive for future comparison
   - Document current performance characteristics
   - Note any existing issues

3. **Optimize Based on Findings:**
   - Fix any blocking operations
   - Optimize hot paths
   - Fix memory leaks
   - Improve async flow

4. **Re-profile After Changes:**
   - Compare before/after metrics
   - Verify improvements
   - Check for regressions

5. **Set Up Monitoring:**
   - Production APM tools
   - CloudWatch metrics
   - Custom SQS queue monitoring
   - Alert on anomalies

## Resources

- [Clinic.js Documentation](https://clinicjs.org/)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [@ssut/nestjs-sqs](https://github.com/ssut/nestjs-sqs)
- [AWS SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html)
- [Quick Start Guide](./CLINIC_SETUP_SUMMARY.md)
- [Scripts Reference](./scripts/README.md)

---

**Ready to profile?** Run: `./scripts/clinic-profile.sh doctor 100`
