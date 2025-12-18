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
echo ""

# Check if dist/src/main.js exists
if [ ! -f "dist/src/main.js" ]; then
  echo -e "${YELLOW}Building application...${NC}"
  npm run build
  echo ""
fi

# Create temporary file for profiler PID
PID_FILE=$(mktemp)
trap "rm -f $PID_FILE" EXIT

echo -e "${BLUE}[1/4]${NC} Starting Clinic.js ${TOOL} profiler..."

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
echo $PROFILER_PID > $PID_FILE

echo -e "${GREEN}✓${NC} Profiler started (PID: ${PROFILER_PID})"
echo ""

# Wait for application to initialize
echo -e "${BLUE}[2/4]${NC} Waiting ${STARTUP_WAIT}s for microservice to initialize..."
for i in $(seq $STARTUP_WAIT -1 1); do
  echo -ne "\r${YELLOW}⏳ ${i}s remaining...${NC}"
  sleep 1
done
echo -e "\r${GREEN}✓${NC} Microservice should be ready                    "
echo ""

# Send load test
echo -e "${BLUE}[3/4]${NC} Sending ${MESSAGE_COUNT} messages to SQS queue..."
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
echo -e "${BLUE}[4/4]${NC} Waiting ${PROCESSING_WAIT}s for message processing to complete..."
for i in $(seq $PROCESSING_WAIT -1 1); do
  echo -ne "\r${YELLOW}⏳ ${i}s remaining...${NC}"
  sleep 1
done
echo -e "\r${GREEN}✓${NC} Processing time elapsed                    "
echo ""

# Stop the profiler
echo -e "${YELLOW}Stopping profiler and generating report...${NC}"
echo -e "${YELLOW}Press Ctrl+C now or wait for automatic shutdown in 3s${NC}"
sleep 3

# Send SIGINT to profiler (Ctrl+C)
kill -INT $PROFILER_PID 2>/dev/null || true

# Wait for profiler to finish generating report
wait $PROFILER_PID 2>/dev/null || true

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Profiling Complete!                                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}The HTML report should open automatically in your browser.${NC}"
echo -e "${BLUE}If not, look for a .clinic-${TOOL}-* folder in the current directory.${NC}"
echo ""
