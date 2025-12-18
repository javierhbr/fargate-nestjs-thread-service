#!/bin/bash

# 0x Flamegraph Profiling Script for SQS Microservice
# Alternative to Clinic Flame - more stable on macOS
#
# Usage:
#   ./scripts/0x-profile.sh <message-count>
#
# Examples:
#   ./scripts/0x-profile.sh 50
#   WORKER_POOL_SIZE=8 ./scripts/0x-profile.sh 100

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
MESSAGE_COUNT=${1:-50}
STARTUP_WAIT=${STARTUP_WAIT:-5}  # Seconds to wait for app startup
SKIP_DYNAMODB_SETUP=${SKIP_DYNAMODB_SETUP:-false}
CLEAR_DATA=${CLEAR_DATA:-false}  # Default false for 0x (faster iterations)

# Print banner
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  0x Flamegraph Profiling - SQS Microservice           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Tool:${NC}           0x flamegraph"
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

echo -e "${BLUE}[2/5]${NC} Starting 0x profiler..."

# Create temporary script to run load test after startup
LOAD_TEST_SCRIPT=$(mktemp)
cat > "$LOAD_TEST_SCRIPT" <<'LOAD_TEST_EOF'
#!/bin/bash
MESSAGE_COUNT=$1
PROCESSING_WAIT=$2

echo ""
echo "⏳ Waiting for application to start..."
sleep 5

echo "🚀 Sending $MESSAGE_COUNT messages to SQS queue..."
node scripts/clinic-load-test.js $MESSAGE_COUNT

if [ $? -eq 0 ]; then
  echo "✓ Load test completed successfully"
else
  echo "✗ Load test failed"
  exit 1
fi

echo ""
echo "⏳ Waiting ${PROCESSING_WAIT}s for message processing..."
sleep $PROCESSING_WAIT

echo "✓ Processing complete - press Ctrl+C to generate flamegraph"
LOAD_TEST_EOF

chmod +x "$LOAD_TEST_SCRIPT"

# Start load test in background
PROCESSING_WAIT=${PROCESSING_WAIT:-10}
$LOAD_TEST_SCRIPT $MESSAGE_COUNT $PROCESSING_WAIT &
LOAD_TEST_PID=$!

# Start 0x profiler (it will run the app and wait for Ctrl+C)
npx 0x -- node dist/src/main.js

# Cleanup
rm -f "$LOAD_TEST_SCRIPT"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Profiling Complete!                                   ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}The HTML flamegraph should open automatically in your browser.${NC}"
echo -e "${BLUE}If not, look for a profile-* folder in the current directory.${NC}"
echo ""
echo -e "${YELLOW}Note: Mock Export API is still running. Stop it with Ctrl+C in its terminal.${NC}"
echo ""
