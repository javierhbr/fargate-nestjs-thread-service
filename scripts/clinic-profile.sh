#!/bin/bash

# Clinic.js Profiling Wrapper for SQS Microservice
# Automates the two-step process of profiling and load testing
#
# Usage:
#   ./scripts/clinic-profile.sh <tool> <message-count> [env-vars]
#
# Examples:
#   ./scripts/clinic-profile.sh doctor 100
#   ./scripts/clinic-profile.sh bubble 50
#   WORKER_POOL_SIZE=8 ./scripts/clinic-profile.sh flame 200
#
# Tools: doctor, bubble, flame, heap

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load clinic environment if available
if [ -f ".env.clinic" ]; then
  echo -e "${BLUE}Loading .env.clinic configuration...${NC}"
  set -a
  source .env.clinic
  set +a
elif [ -f ".env" ]; then
  echo -e "${YELLOW}Warning: .env.clinic not found, using .env${NC}"
  echo -e "${YELLOW}Consider creating .env.clinic for optimized profiling${NC}"
fi

# Configuration
TOOL=${1:-doctor}
MESSAGE_COUNT=${2:-100}
STARTUP_WAIT=${STARTUP_WAIT:-5}  # Seconds to wait for app startup
SKIP_DYNAMODB_SETUP=${SKIP_DYNAMODB_SETUP:-false}  # Set to true to skip DynamoDB setup
CLEAR_DATA=${CLEAR_DATA:-true}  # Set to false to skip clearing data before profiling

# Validate tool
if [[ ! "$TOOL" =~ ^(doctor|bubble|flame|heap)$ ]]; then
  echo -e "${RED}Error: Invalid tool '${TOOL}'${NC}"
  echo "Valid tools: doctor, bubble, flame, heap"
  exit 1
fi

# Print banner
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Clinic.js Profiling - SQS Microservice               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Tool:${NC}           clinic ${TOOL}"
echo -e "${GREEN}Messages:${NC}       ${MESSAGE_COUNT}"
echo -e "${GREEN}Startup wait:${NC}   ${STARTUP_WAIT}s"
if [ "$CLEAR_DATA" = "true" ]; then
  echo -e "${GREEN}Clear data:${NC}     Yes"
fi
echo ""

# Clear existing data if requested
if [ "$CLEAR_DATA" = "true" ]; then
  echo -e "${BLUE}[0/5]${NC} Clearing existing data (DynamoDB + SQS)..."
  node scripts/clinic-clear-data.js

  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Data clear failed, continuing anyway...${NC}"
  fi
  echo ""
fi

# Setup DynamoDB test data (unless skipped)
if [ "$SKIP_DYNAMODB_SETUP" = "false" ]; then
  echo -e "${BLUE}[1/5]${NC} Setting up DynamoDB test data..."
  node scripts/clinic-setup-dynamodb.js $MESSAGE_COUNT

  if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  DynamoDB setup failed, continuing anyway...${NC}"
    echo -e "${YELLOW}   (Set SKIP_DYNAMODB_SETUP=true to skip this step)${NC}"
  fi
  echo ""
fi

# Check if dist/src/main.js exists
if [ ! -f "dist/src/main.js" ]; then
  echo -e "${YELLOW}Building application...${NC}"
  npm run build
  echo ""
fi

# Check if Mock Export API is running
echo -e "${BLUE}[1.5/5]${NC} Checking Mock Export API server..."
if curl -s -f http://localhost:8080/health >/dev/null 2>&1; then
  echo -e "${GREEN}✓${NC} Mock Export API is running on port 8080"
  echo ""
else
  echo -e "${YELLOW}⚠️  Mock Export API is not running${NC}"
  echo -e "${YELLOW}   Please start it in a separate terminal:${NC}"
  echo -e "${YELLOW}   npm run mock-api${NC}"
  echo ""
  echo -e "${YELLOW}Press Enter to continue anyway (will have Export API errors)...${NC}"
  read -r
fi

echo -e "${BLUE}[2/5]${NC} Starting Clinic.js ${TOOL} profiler..."

# Start the profiler in background
case "$TOOL" in
  doctor)
    npx clinic doctor -- node dist/src/main.js &
    ;;
  bubble)
    npx clinic bubbleprof -- node dist/src/main.js &
    ;;
  flame)
    npx clinic flame -- node dist/src/main.js &
    ;;
  heap)
    npx clinic heapprofiler -- node dist/src/main.js &
    ;;
esac

PROFILER_PID=$!

# Create temporary file for profiler PID
PID_FILE=$(mktemp)
trap "rm -f $PID_FILE" EXIT
echo $PROFILER_PID > $PID_FILE

echo -e "${GREEN}✓${NC} Profiler started (PID: ${PROFILER_PID})"
echo ""

# Wait for application to initialize
echo -e "${BLUE}[3/5]${NC} Waiting ${STARTUP_WAIT}s for microservice to initialize..."
for i in $(seq $STARTUP_WAIT -1 1); do
  echo -ne "\r${YELLOW}⏳ ${i}s remaining...${NC}"
  sleep 1
done
echo -e "\r${GREEN}✓${NC} Microservice should be ready                    "
echo ""

# Send load test
echo -e "${BLUE}[4/5]${NC} Sending ${MESSAGE_COUNT} messages to SQS queue..."
node scripts/clinic-load-test.js $MESSAGE_COUNT

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✓${NC} Load test completed successfully"
else
  echo -e "${RED}✗${NC} Load test failed"
  kill $PROFILER_PID 2>/dev/null || true
  exit 1
fi
echo ""

# Optional: Wait a bit more for message processing to complete
PROCESSING_WAIT=${PROCESSING_WAIT:-10}
echo -e "${BLUE}[5/5]${NC} Waiting ${PROCESSING_WAIT}s for message processing to complete..."
for i in $(seq $PROCESSING_WAIT -1 1); do
  echo -ne "\r${YELLOW}⏳ ${i}s remaining...${NC}"
  sleep 1
done
echo -e "\r${GREEN}✓${NC} Processing time elapsed                    "
echo ""

# Stop the profiler
echo ""
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Stopping profiler and generating report...${NC}"
echo -e "${YELLOW}DO NOT press Ctrl+C - report generation in progress!${NC}"
echo -e "${YELLOW}════════════════════════════════════════════════════════${NC}"
echo ""

# Send SIGINT to profiler to trigger report generation
kill -INT $PROFILER_PID 2>/dev/null || true

# Wait for profiler to finish generating report (with timeout monitoring)
echo -ne "⏳ Generating report..."
WAIT_COUNT=0
while kill -0 $PROFILER_PID 2>/dev/null; do
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
  echo -ne "\r⏳ Generating report... ${WAIT_COUNT}s"

  # Timeout after 30 seconds - flame profiler sometimes hangs
  if [ $WAIT_COUNT -gt 30 ]; then
    echo -e "\r${YELLOW}⚠️${NC} Report generation taking longer than expected..."
    echo -e "${YELLOW}   Trying forceful shutdown...${NC}"
    kill -9 $PROFILER_PID 2>/dev/null || true
    sleep 2

    # Check if report was generated despite the hang
    LATEST_REPORT=$(ls -t .clinic-${TOOL}-* 2>/dev/null | head -1)
    if [ -n "$LATEST_REPORT" ]; then
      echo -e "${GREEN}✓${NC} Report found: ${LATEST_REPORT}"
      echo -e "${YELLOW}   Opening report manually...${NC}"
      open "${LATEST_REPORT}/index.html" 2>/dev/null || true
      break
    else
      echo -e "${RED}✗${NC} No report generated - profiler may have crashed"
      exit 1
    fi
  fi
done

echo -e "\r${GREEN}✓${NC} Report generated in ${WAIT_COUNT}s                    "
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Profiling Complete!                                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}The HTML report should open automatically in your browser.${NC}"
echo -e "${BLUE}If not, look for a .clinic-${TOOL}-* folder in the current directory.${NC}"
echo ""
echo -e "${YELLOW}Note: Mock Export API is still running. Stop it with Ctrl+C in its terminal.${NC}"
echo ""
