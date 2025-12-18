# Clinic.js Profiling - Quick Start Card

## 🚀 First Time Setup (One-Time)

```bash
# 1. Ensure LocalStack is running
docker-compose up -d

# 2. Start Mock Export API (keep running in separate terminal)
npm run mock-api

# 3. Everything else is ready!
```

## 📊 Common Profiling Commands

**Two-Terminal Workflow:**
- **Terminal 1**: Mock API server (`npm run mock-api`) - keep running
- **Terminal 2**: Profiling commands (see below)

### Clean Baseline (Default Behavior)

```bash
# Clean data by default - just run it!
./scripts/clinic-profile.sh doctor 100

# Explicitly clear (same as above)
CLEAR_DATA=true ./scripts/clinic-profile.sh doctor 100
```

### CPU Profiling (Flamegraph)

**IMPORTANT:** Clinic Flame is unstable on macOS. Use **0x** instead:

```bash
# Skip data clearing AND DynamoDB setup for fastest iterations
CLEAR_DATA=false SKIP_DYNAMODB_SETUP=true ./scripts/0x-profile.sh 50

# After app starts and load test completes, press Ctrl+C to generate flamegraph
```

### Async Operations (Clean by Default)

```bash
# Clean data automatically (default)
./scripts/clinic-profile.sh bubble 100
```

### Test Different Worker Sizes

```bash
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100
```

## 📋 Profiling Tools

| Tool | Purpose | When to Use | Notes |
|------|---------|-------------|-------|
| `doctor` | Event loop health | Detect blocking operations | ✅ Stable |
| `bubble` | Async operations | Understand async delays | ✅ Stable |
| `0x` | CPU flamegraph | Find hot code paths | ✅ **Use instead of flame** |
| `flame` | CPU profiling | ~~Find hot code paths~~ | ❌ Unstable on macOS |
| `heap` | Memory usage | Track allocations | ✅ Stable |

## 🎯 Quick Decision Guide

**Choose your scenario:**

1. **"I want a clean baseline"**
   ```bash
   # Clean data by default - just run it!
   ./scripts/clinic-profile.sh doctor 100
   ```

2. **"I'm testing CPU optimization (fast iterations)"**
   ```bash
   # Use 0x instead of flame (more stable)
   CLEAR_DATA=false SKIP_DYNAMODB_SETUP=true ./scripts/0x-profile.sh 50
   # Press Ctrl+C after load test completes to generate flamegraph
   ```

3. **"I need to analyze async operations"**
   ```bash
   # Clean by default
   ./scripts/clinic-profile.sh bubble 100
   ```

4. **"I'm comparing before/after changes"**
   ```bash
   # Before changes (clean data automatically)
   ./scripts/clinic-profile.sh doctor 100

   # Make changes, then:
   ./scripts/clinic-profile.sh doctor 100
   ```

## 🔧 Useful Commands

```bash
# Clear all test data
node scripts/clinic-clear-data.js

# Check DynamoDB count
aws --endpoint-url=http://localhost:4566 dynamodb scan \
  --table-name export-job-state --select COUNT

# Monitor SQS queues
npm run clinic:monitor

# Save baseline reports
mkdir -p .clinic-baselines/$(date +%Y%m%d)
mv .clinic-* .clinic-baselines/$(date +%Y%m%d)/
```

## ⚙️ Environment Variables

```bash
# Clear data before profiling (default: false) - USE FOR BASELINES
CLEAR_DATA=true ./scripts/clinic-profile.sh doctor 100

# Skip DynamoDB setup (default: false) - USE FOR ITERATIONS
SKIP_DYNAMODB_SETUP=true ./scripts/clinic-profile.sh flame 100

# Worker pool size (default: 4)
WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100

# Startup wait time (default: 5s)
STARTUP_WAIT=10 ./scripts/clinic-profile.sh doctor 100

# Processing wait time (default: 10s)
PROCESSING_WAIT=20 ./scripts/clinic-profile.sh doctor 100

# Combine multiple options
CLEAR_DATA=true WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh doctor 100
```

## 📚 Full Documentation

- [PROFILING_WORKFLOW.md](PROFILING_WORKFLOW.md) - Complete workflows
- [PROFILING_SETUP.md](PROFILING_SETUP.md) - Initial setup guide
- [scripts/README.md](scripts/README.md) - Scripts reference

## ❓ Troubleshooting

**"Conditional request failed" errors?**
→ Run `node scripts/clinic-clear-data.js` first

**Empty bubble report?**
→ Use more messages: `./scripts/clinic-profile.sh bubble 200`

**Can't purge queue?**
→ Wait 60s between purge attempts

**LocalStack not running?**
→ `docker-compose up -d`

## 💡 Pro Tips

- ✅ Always clear data for bubble profiling
- ✅ Skip DynamoDB setup for CPU/memory iterations
- ✅ Save baseline reports for comparison
- ✅ Use consistent message counts
- ❌ Don't compare runs with different parameters
