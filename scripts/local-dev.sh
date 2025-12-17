#!/bin/bash
set -e

# Local development script

echo "Starting local development environment..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please update .env with your configuration"
    exit 1
fi

# Check if localstack is running (optional)
if command -v docker &> /dev/null; then
    if docker ps | grep -q localstack; then
        echo "LocalStack is running"
        export AWS_ENDPOINT_URL=http://localhost:4566
    fi
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Start the application in watch mode
echo "Starting application..."
pnpm start:dev
