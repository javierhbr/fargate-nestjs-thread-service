# Performance Testing with Clinic.js

This guide explains how to use Clinic.js to detect blocking operations, memory leaks, and performance issues in the worker thread pool.

## Overview

Clinic.js is a suite of Node.js performance profiling tools that help identify:
- **Event loop blocking** (Doctor)
- **Async operations delays** (Bubbleprof)
- **CPU bottlenecks** (Flame)
- **Memory leaks** (Heap Profiler)

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

### 1. Start Clinic Doctor (Detect Event Loop Blocking)

**Clinic Doctor** detects event loop delays and helps identify blocking operations:

```bash
npm run clinic:doctor
```

This will:
1. Start the application with profiling enabled
2. Send load (10 concurrent connections for 30 seconds to `/health`)
3. Generate an HTML report showing event loop delays
4. Open the report in your browser

**What to look for:**
- 🟢 **Green**: Healthy event loop (< 10ms delays)
- 🟡 **Yellow**: Moderate delays (10-100ms)
- 🔴 **Red**: Severe blocking (> 100ms) - **Action required!**

### 2. Start Clinic Bubbleprof (Async Operations Analysis)

**Bubbleprof** visualizes async operations and identifies slow async paths:

```bash
npm run clinic:bubble
```

**What to look for:**
- Large bubbles indicate slow async operations
- Long chains suggest sequential bottlenecks
- Wide spreads suggest good parallelism

### 3. Start Clinic Flame (CPU Profiling)

**Flame Graph** shows CPU usage and identifies hot code paths:

```bash
npm run clinic:flame
```

**What to look for:**
- Wide flame graph sections indicate CPU-intensive functions
- Identify functions consuming most CPU time
- Optimize hot paths for better performance

### 4. Start Clinic Heap Profiler (Memory Leak Detection)

**Heap Profiler** tracks memory allocations over time:

```bash
npm run clinic:heap
```

**What to look for:**
- Steadily increasing memory usage (potential leak)
- Large object allocations
- Objects not being garbage collected

## Testing Worker Thread Pool Under Load

For more realistic testing of the worker thread pool, use the custom load test script:

### Step 1: Start the application with Clinic Doctor

```bash
# In Terminal 1: Start with Doctor profiling
clinic doctor -- node dist/main.js
```

Wait for the message: `Export Processing Service started on port 3000`

### Step 2: Send test messages to trigger worker processing

```bash
# In Terminal 2: Send 50 test messages to SQS
node scripts/clinic-load-test.js 50
```

This sends export job messages that will:
- Trigger SQS consumers
- Dispatch tasks to worker threads
- Download files from httpbin.org (with 2s delay)
- Upload results to S3 (LocalStack)
- Exercise the entire worker pool pipeline

### Step 3: Stop profiling and view results

```bash
# In Terminal 1: Press Ctrl+C to stop the application
# Clinic will automatically generate and open the report
```

## Custom Load Test Configurations

### Light Load (2 workers, 10 messages)
```bash
# Set smaller pool size for testing
export WORKER_POOL_SIZE=2
export MAX_CONCURRENT_JOBS=5

# Start with profiling
clinic doctor -- node dist/main.js

# In another terminal
node scripts/clinic-load-test.js 10
```

### Heavy Load (4 workers, 100 messages)
```bash
export WORKER_POOL_SIZE=4
export MAX_CONCURRENT_JOBS=20

clinic doctor -- node dist/main.js

# In another terminal
node scripts/clinic-load-test.js 100
```

### Stress Test (8 workers, 500 messages)
```bash
export WORKER_POOL_SIZE=8
export MAX_CONCURRENT_JOBS=40

clinic doctor -- node dist/main.js

# In another terminal
node scripts/clinic-load-test.js 500
```

## Interpreting Results

### Event Loop Blocking (Doctor)

**Good Performance:**
```
Event Loop Delay: < 10ms
CPU Usage: 60-90% (shows efficient parallel processing)
No red spikes in the graph
```

**Blocking Detected:**
```
Event Loop Delay: > 100ms (RED ZONES)
Possible causes:
- Synchronous file operations in main thread
- Heavy computation outside worker threads
- Blocking I/O operations
- Large JSON parsing in main thread
```

**Solutions:**
1. Move blocking operations to worker threads
2. Use async/await for all I/O operations
3. Avoid large synchronous operations
4. Use streaming for large data processing

### Async Delays (Bubbleprof)

**Good Performance:**
```
Small, evenly distributed bubbles
Multiple parallel operations (wide spread)
Short async chains
```

**Issues:**
```
Large bubbles: Slow async operations (DB, S3, SQS)
Long chains: Sequential bottlenecks
Clustered bubbles: Resource contention
```

**Solutions:**
1. Increase parallelism (more workers)
2. Optimize slow operations (caching, batching)
3. Use connection pooling
4. Reduce sequential dependencies

### CPU Usage (Flame)

**Good Performance:**
```
Even distribution across functions
No single function dominating (> 50%)
Worker thread code visible in flame graph
```

**Issues:**
```
One function consuming > 50% CPU
V8 GC (garbage collection) taking > 20%
JSON parsing/serialization dominating
```

**Solutions:**
1. Optimize hot functions
2. Reduce object allocations
3. Use object pooling
4. Optimize JSON operations (use streams)

### Memory Usage (Heap)

**Good Performance:**
```
Sawtooth pattern (allocate → GC → allocate)
Memory returns to baseline after GC
Stable peak memory usage
```

**Issues:**
```
Continuously increasing memory (leak)
Memory never returns to baseline
Large spikes without recovery
```

**Solutions:**
1. Fix memory leaks (unreleased references)
2. Reduce object creation
3. Clear event listeners
4. Limit cache sizes

## Common Worker Thread Pool Issues

### Issue 1: Event Loop Blocking from Message Processing

**Symptom:**
- Red zones in Clinic Doctor during SQS message processing
- High event loop delays (> 100ms)

**Cause:**
- Large message body parsing in main thread
- Synchronous validation before dispatching to workers

**Solution:**
```typescript
// ❌ BAD: Synchronous JSON parsing
const message = JSON.parse(largeMessageBody);

// ✅ GOOD: Already async in our implementation
// Message parsing happens in separate SQS consumer context
```

### Issue 2: Worker Thread Starvation

**Symptom:**
- Tasks queuing up (high `queuedTasks` in health check)
- Bubbleprof shows long wait times

**Cause:**
- Too few worker threads for the workload
- Workers blocked on slow operations

**Solution:**
```bash
# Increase worker pool size
WORKER_POOL_SIZE=8

# Increase concurrency limit
MAX_CONCURRENT_JOBS=40
```

### Issue 3: Memory Leak in Workers

**Symptom:**
- Heap profiler shows continuous memory growth
- Workers consuming increasing memory over time

**Cause:**
- File handles not closed
- Temporary files not cleaned up
- Event listeners not removed

**Solution:**
- Check worker restart frequency in logs
- Verify temp file cleanup
- Ensure proper error handling with cleanup

## Advanced Testing Scenarios

### Test 1: Verify No Main Thread Blocking

**Goal:** Ensure worker threads don't block the main event loop

```bash
# Start with Doctor
clinic doctor -- node dist/main.js

# Send sustained load
node scripts/clinic-load-test.js 200

# Expected: Green graph, event loop delays < 10ms
# If red zones appear, blocking is happening in main thread
```

### Test 2: Verify Worker Isolation

**Goal:** Ensure worker crashes don't affect the main thread

```bash
# Modify a worker to crash (for testing only)
# Add to worker-thread.ts:
setTimeout(() => { throw new Error('Test crash'); }, 5000);

# Run with Doctor
clinic doctor -- node dist/main.js

# Send messages
node scripts/clinic-load-test.js 20

# Expected: Worker respawns, main thread continues normally
```

### Test 3: Memory Leak Detection

**Goal:** Verify no memory leaks in worker pool

```bash
# Run with heap profiler for extended time
clinic heapprofiler -- node dist/main.js

# Send waves of messages over 5 minutes
for i in {1..10}; do
  node scripts/clinic-load-test.js 50
  sleep 30
done

# Expected: Sawtooth memory pattern, no continuous growth
```

## Continuous Monitoring

For production monitoring, consider:

1. **APM Tools:**
   - New Relic
   - Datadog APM
   - AWS X-Ray

2. **Custom Metrics:**
   - Export worker pool metrics to CloudWatch
   - Alert on high queue depth
   - Monitor worker restart rate

3. **Regular Profiling:**
   - Run Clinic.js tests before deployments
   - Profile under production-like load
   - Establish performance baselines

## Troubleshooting

### Clinic reports "No data collected"

**Solution:**
- Ensure application starts successfully
- Check that `--on-port` command runs (autocannon)
- Verify port 3000 is accessible

### "ECONNREFUSED" when running load test

**Solution:**
```bash
# Ensure LocalStack is running
docker-compose ps

# Verify queue exists
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1 \
  aws --endpoint-url=http://localhost:4566 sqs list-queues
```

### Worker threads not showing in flame graph

**Solution:**
- Worker threads run in separate V8 isolates
- Main thread profiling won't show worker internals
- Focus on main thread message passing overhead
- Use worker logs to debug worker-specific issues

## Best Practices

1. **Always build before profiling:**
   ```bash
   npm run build
   clinic doctor -- node dist/main.js
   ```

2. **Use realistic load:**
   - Match production message sizes
   - Simulate actual URL download times
   - Test with production worker pool size

3. **Profile multiple scenarios:**
   - Light load (baseline)
   - Normal load (typical production)
   - Heavy load (peak traffic)
   - Stress test (failure modes)

4. **Compare before/after:**
   - Profile before optimization
   - Make one change
   - Profile again to measure impact

5. **Document findings:**
   - Save Clinic reports
   - Note configuration used
   - Record any issues found

## References

- [Clinic.js Documentation](https://clinicjs.org/)
- [Node.js Worker Threads Guide](https://nodejs.org/docs/latest-v20.x/api/worker_threads.html)
- [Event Loop Best Practices](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/)
- [Autocannon Load Testing](https://github.com/mcollina/autocannon)
