# Clinic.js Setup Summary

Clinic.js has been successfully configured to detect blocking operations in the worker thread pool.

## What Was Installed

### Dependencies
- **clinic** (v13.0.0) - Performance profiling suite
- **autocannon** (v8.0.0) - HTTP load testing tool

### NPM Scripts Added

```json
{
  "clinic:doctor": "clinic doctor --on-port 'autocannon -c 10 -d 30 localhost:3000/health' -- node dist/main.js",
  "clinic:bubble": "clinic bubbleprof --on-port 'autocannon -c 10 -d 30 localhost:3000/health' -- node dist/main.js",
  "clinic:flame": "clinic flame --on-port 'autocannon -c 10 -d 30 localhost:3000/health' -- node dist/main.js",
  "clinic:heap": "clinic heapprofiler --on-port 'autocannon -c 10 -d 30 localhost:3000/health' -- node dist/main.js"
}
```

### Files Created

1. **`scripts/clinic-load-test.js`**
   - Custom load testing script
   - Sends test messages to SQS queue
   - Triggers worker thread processing
   - Configurable message count

2. **`PERFORMANCE_TESTING.md`**
   - Comprehensive performance testing guide
   - How to use each Clinic.js tool
   - Interpreting results and reports
   - Common issues and solutions
   - Advanced testing scenarios

3. **`scripts/README.md`**
   - Quick reference for scripts
   - Usage examples
   - Environment variables

4. **`.gitignore` updates**
   - Ignores Clinic.js output files
   - Prevents committing profiling reports

## Quick Start Guide

### 1. Simple Health Check Test

Tests event loop blocking during HTTP requests:

```bash
# Build the application
npm run build

# Run Clinic Doctor
npm run clinic:doctor
```

This automatically:
- Starts the application with profiling
- Sends 10 concurrent requests for 30 seconds
- Generates HTML report
- Opens report in browser

### 2. Worker Thread Load Test

Tests worker pool under realistic load:

```bash
# Terminal 1: Start with profiling
npm run build
clinic doctor -- node dist/main.js

# Wait for: "Export Processing Service started on port 3000"

# Terminal 2: Send 50 test messages
node scripts/clinic-load-test.js 50

# Terminal 1: After processing completes, press Ctrl+C
# Report will automatically open
```

### 3. Memory Leak Detection

Tests for memory leaks over extended period:

```bash
# Terminal 1: Start heap profiler
npm run build
clinic heapprofiler -- node dist/main.js

# Terminal 2: Send sustained load
for i in {1..10}; do
  node scripts/clinic-load-test.js 50
  sleep 30
done

# Terminal 1: Press Ctrl+C after 5+ minutes
# Report will show memory allocation patterns
```

## What Each Tool Does

### Clinic Doctor 🩺
**Purpose:** Detect event loop blocking

**When to use:**
- Suspect main thread is blocked
- Application feels sluggish
- Request latency is high

**What to look for:**
- 🟢 Green zones = Healthy (< 10ms delays)
- 🟡 Yellow zones = Warning (10-100ms delays)
- 🔴 Red zones = **BLOCKING DETECTED** (> 100ms delays)

**Common causes if blocking detected:**
- Synchronous file operations
- Heavy JSON parsing
- Crypto operations in main thread
- Database queries without async/await

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
clinic doctor -- node dist/main.js
# In another terminal:
node scripts/clinic-load-test.js 100
```

If red zones appear:
1. Check main thread is using async/await
2. Verify no synchronous file operations
3. Ensure message parsing is async
4. Move heavy computation to workers

### Scenario 2: Verify Worker Pool Scalability

**Expected Result:** Higher throughput with more workers

```bash
# Test 1: 2 workers
WORKER_POOL_SIZE=2 clinic doctor -- node dist/main.js
# Send 50 messages, note throughput

# Test 2: 8 workers
WORKER_POOL_SIZE=8 clinic doctor -- node dist/main.js
# Send 50 messages, compare throughput
```

Throughput should scale linearly with CPU cores (up to I/O limits).

### Scenario 3: Stress Test Under Heavy Load

**Expected Result:** No event loop blocking even under stress

```bash
WORKER_POOL_SIZE=4 MAX_CONCURRENT_JOBS=20 clinic doctor -- node dist/main.js
# In another terminal:
node scripts/clinic-load-test.js 500
```

Monitor:
- Event loop delays (should stay green)
- Queue depth (check health endpoint)
- Worker restart rate (should be 0)

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
   npm run clinic:doctor
   npm run clinic:bubble
   npm run clinic:flame
   npm run clinic:heap
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
**Solution:** Ensure application starts and autocannon runs successfully

### "ECONNREFUSED" in load test
**Solution:** Verify LocalStack is running (`docker-compose ps`)

### Worker threads not in flame graph
**Solution:** Worker threads run in separate isolates; focus on main thread overhead

### Reports won't open
**Solution:** Check HTML files in current directory, open manually in browser

## Resources

- Full Guide: [PERFORMANCE_TESTING.md](PERFORMANCE_TESTING.md)
- Script Reference: [scripts/README.md](scripts/README.md)
- Clinic.js Docs: https://clinicjs.org/
- Worker Threads: https://nodejs.org/api/worker_threads.html

## Success Criteria

Your worker thread pool is performing well if:

✅ Clinic Doctor shows all green zones
✅ Event loop delays stay under 10ms
✅ Worker pool processes messages in parallel
✅ No memory leaks detected
✅ Throughput scales with worker count
✅ CPU utilization is 60-90% under load
✅ No blocking operations in main thread
✅ Worker crashes are handled gracefully

---

**Ready to test?** Run: `npm run clinic:doctor`
