# Clinic.js Profiling Workflow Guide

This guide provides step-by-step workflows for different profiling scenarios, ensuring clean, comparable results.

## Quick Reference

| Scenario | DynamoDB Setup? | Command |
|----------|----------------|---------|
| **First baseline run** | ✅ Yes (clean) | `./scripts/clinic-clear-data.js && ./scripts/clinic-profile.sh doctor 100` |
| **CPU/Memory comparison** | ❌ Skip | `SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh flame 100` |
| **Async operations** | ✅ Yes (always) | `./scripts/clinic-profile.sh bubble 100` |
| **Subsequent baseline** | ✅ Yes (clean) | `./scripts/clinic-clear-data.js && ./scripts/clinic-profile.sh doctor 100` |

## Complete Workflows

### 1️⃣ First-Time Baseline Profiling (Clean Slate)

**Goal:** Establish clean baseline metrics with no noise from previous runs.

```bash
# Step 1: Clear all existing data
node scripts/clinic-clear-data.js

# Step 2: Run baseline profiling with fresh data
./scripts/clinic-profile.sh doctor 100

# Step 3: Save baseline for future comparison
mkdir -p .clinic-baselines
mv .clinic-doctor-* .clinic-baselines/baseline-$(date +%Y%m%d-%H%M)/
```

**What happens:**
- ✅ Clears all DynamoDB test jobs
- ✅ Purges SQS queues
- ✅ Creates fresh test data
- ✅ Clean profiling with no errors
- ✅ Saves results for comparison

---

### 2️⃣ CPU/Memory Profiling (Flame/Heap)

**Goal:** Compare CPU or memory patterns across code changes.

```bash
# First run (baseline - clean data)
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh flame 100

# Subsequent runs (skip DynamoDB setup for speed)
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh flame 100

# Or test with different worker pool sizes
SKIP_DYNAMODB_SETUP=true WORKER_POOL_SIZE=2 ./scripts/clinic-profile.sh flame 100
SKIP_DYNAMODB_SETUP=true WORKER_POOL_SIZE=4 ./scripts/clinic-profile.sh flame 100
SKIP_DYNAMODB_SETUP=true WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh flame 100
```

**Why skip DynamoDB setup?**
- Faster iterations (saves ~0.2s per run)
- CPU/memory patterns aren't significantly affected by DynamoDB errors
- Focus on comparing code execution, not data state

**When to include setup:**
- First baseline run (clean slate)
- When DynamoDB operations are the focus
- When you want absolutely clean logs

---

### 3️⃣ Async Operations Profiling (Bubble)

**Goal:** Analyze async operation chains and delays.

```bash
# ALWAYS use clean data for bubble profiling
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh bubble 100

# For more detailed async analysis, use more messages
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh bubble 200
```

**Why always clean data?**
- ⚠️ DynamoDB errors create extra async branches
- ⚠️ Retry loops pollute the async operation graph
- ⚠️ Harder to identify actual bottlenecks
- ✅ Clean data = clear async visualization

**Best practices:**
- Always clear data before bubble profiling
- Use 100-200 messages for good coverage
- Focus on async operation patterns, not error handling

---

### 4️⃣ Event Loop Profiling (Doctor)

**Goal:** Detect event loop blocking and delays.

```bash
# Baseline with clean data
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh doctor 100

# Quick iteration (skip setup if just testing code changes)
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh doctor 100
```

**When to use clean data:**
- Initial baseline
- When comparing event loop behavior
- When testing queue processing patterns

**When to skip setup:**
- Quick iterations on code changes
- Comparing worker pool configurations
- Focus is on blocking operations, not data state

---

### 5️⃣ Comparative Analysis Workflow

**Goal:** Compare performance before and after code changes.

```bash
# 1. Baseline (BEFORE changes)
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh doctor 100
mv .clinic-doctor-* .clinic-baselines/before-$(date +%Y%m%d)/

# 2. Make your code changes
git checkout feature/my-optimization

# 3. Clear and rebuild
node scripts/clinic-clear-data.js
npm run build

# 4. Profile with same parameters (AFTER changes)
./scripts/clinic-profile.sh doctor 100
mv .clinic-doctor-* .clinic-baselines/after-$(date +%Y%m%d)/

# 5. Compare the two reports
echo "Compare:"
echo "  Before: .clinic-baselines/before-$(date +%Y%m%d)/"
echo "  After:  .clinic-baselines/after-$(date +%Y%m%d)/"
```

---

### 6️⃣ Multi-Tool Comprehensive Analysis

**Goal:** Full performance analysis with all tools.

```bash
# Clear data once
node scripts/clinic-clear-data.js

# Run all profiling tools
./scripts/clinic-profile.sh doctor 100  # Event loop
./scripts/clinic-profile.sh bubble 100  # Async ops
./scripts/clinic-profile.sh flame 200   # CPU hotspots
./scripts/clinic-profile.sh heap 100    # Memory allocation

# Save all results
mkdir -p .clinic-baselines/full-$(date +%Y%m%d)/
mv .clinic-* .clinic-baselines/full-$(date +%Y%m%d)/
```

**Analysis order:**
1. **Doctor** - Check for event loop issues
2. **Bubble** - Understand async patterns
3. **Flame** - Identify CPU bottlenecks
4. **Heap** - Check memory usage

---

### 7️⃣ Worker Pool Scalability Testing

**Goal:** Find optimal worker pool size.

```bash
# Clear data once
node scripts/clinic-clear-data.js

# Test different pool sizes
for WORKERS in 2 4 8 16; do
  echo "Testing with $WORKERS workers..."
  SKIP_DYNAMODB_SETUP=true WORKER_POOL_SIZE=$WORKERS ./scripts/clinic-profile.sh flame 100
  mkdir -p .clinic-baselines/workers-$WORKERS/
  mv .clinic-flame-* .clinic-baselines/workers-$WORKERS/
done

# Compare results
echo "Compare worker pool configurations:"
ls -la .clinic-baselines/workers-*/
```

---

### 8️⃣ Load Testing at Scale

**Goal:** Test high-volume scenarios.

```bash
# Clear and setup for high load
node scripts/clinic-clear-data.js

# High-load profiling
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 500

# Monitor in another terminal
npm run clinic:monitor
```

---

## Commands Summary

### Data Management

```bash
# Clear all test data (DynamoDB + SQS + generated files)
node scripts/clinic-clear-data.js

# Setup DynamoDB only (without profiling)
node scripts/clinic-setup-dynamodb.js 100

# Check current DynamoDB count
aws --endpoint-url=http://localhost:4566 dynamodb scan \
  --table-name export-job-state --select COUNT
```

### Profiling

```bash
# With automatic DynamoDB setup (default)
./scripts/clinic-profile.sh doctor 100

# Skip DynamoDB setup (faster iterations)
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh flame 100

# Custom worker pool size
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100

# Custom startup wait time
STARTUP_WAIT=10 ./scripts/clinic-profile.sh doctor 100
```

### Report Management

```bash
# Save baseline
mkdir -p .clinic-baselines/baseline-$(date +%Y%m%d)/
mv .clinic-* .clinic-baselines/baseline-$(date +%Y%m%d)/

# Clean up old reports
rm -rf .clinic-doctor-*
rm -rf .clinic-bubble-*
rm -rf .clinic-flame-*
rm -rf .clinic-heap-*
```

---

## Decision Tree

```
START
  │
  ├─ Is this your first profiling run?
  │    YES → Clear data + Full setup
  │    NO  → Continue
  │
  ├─ Are you using Bubble profiler?
  │    YES → Clear data + Full setup (always)
  │    NO  → Continue
  │
  ├─ Are you comparing against baseline?
  │    YES → Clear data + Full setup (for consistency)
  │    NO  → Continue
  │
  ├─ Are you just iterating on CPU/memory optimization?
  │    YES → Skip DynamoDB setup (faster)
  │    NO  → Full setup recommended
  │
  └─ END
```

---

## Best Practices

### ✅ DO

- **Clear data before baseline runs** - Ensures clean slate
- **Use same message count for comparisons** - Consistent load
- **Save baseline reports** - For future comparison
- **Skip setup for CPU/memory iterations** - Saves time
- **Always setup for bubble profiling** - Clean async graphs
- **Document your findings** - Track improvements

### ❌ DON'T

- **Skip cleanup before first run** - Stale data skews results
- **Compare runs with different message counts** - Inconsistent load
- **Delete baseline reports immediately** - Need for comparison
- **Use bubble without clean data** - Polluted async graphs
- **Change multiple variables at once** - Can't identify cause

---

## Troubleshooting

### Issue: "Conditional request failed" errors

**Cause:** DynamoDB doesn't have job records for the UUIDs being processed.

**Solutions:**
```bash
# Option 1: Clear and setup fresh data
node scripts/clinic-clear-data.js
./scripts/clinic-profile.sh doctor 100

# Option 2: Accept the errors for CPU/memory profiling
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh flame 100
```

### Issue: Bubble profiler shows empty results

**Causes:**
- Not enough async operations (use more messages)
- Transpiled code (expected warning)
- Too short runtime

**Solutions:**
```bash
# Use more messages for better coverage
./scripts/clinic-profile.sh bubble 200

# Increase processing wait time
PROCESSING_WAIT=20 ./scripts/clinic-profile.sh bubble 200
```

### Issue: Can't purge SQS queue

**Error:** "PurgeQueueInProgress"

**Solution:**
```bash
# Wait 60 seconds between purge attempts
echo "Waiting 60s for queue purge to complete..."
sleep 60
node scripts/clinic-clear-data.js
```

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `SKIP_DYNAMODB_SETUP` | `false` | Skip DynamoDB pre-population |
| `WORKER_POOL_SIZE` | `4` | Number of worker threads |
| `STARTUP_WAIT` | `5` | Seconds to wait for app startup |
| `PROCESSING_WAIT` | `10` | Seconds to wait after messages sent |
| `AWS_ENDPOINT` | `http://localhost:4566` | LocalStack endpoint |
| `DYNAMODB_TABLE_NAME` | `export-job-state` | DynamoDB table name |

---

## Next Steps

1. **Run your first baseline:**
   ```bash
   node scripts/clinic-clear-data.js
   ./scripts/clinic-profile.sh doctor 100
   ```

2. **Save the baseline:**
   ```bash
   mkdir -p .clinic-baselines
   mv .clinic-doctor-* .clinic-baselines/baseline-$(date +%Y%m%d)/
   ```

3. **Iterate and improve:**
   - Make code changes
   - Profile again with same parameters
   - Compare results
   - Document findings

4. **Share insights:**
   - Document performance characteristics
   - Track improvements over time
   - Share with team

---

## Related Documentation

- [PROFILING_SETUP.md](PROFILING_SETUP.md) - Initial setup guide
- [scripts/README.md](scripts/README.md) - Scripts documentation
- [Clinic.js Documentation](https://clinicjs.org/) - Official docs
