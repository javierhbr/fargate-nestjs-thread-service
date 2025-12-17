#!/bin/bash
set -e

# Build script

echo "Building export-service..."

# Clean previous build
rm -rf dist

# Install dependencies
pnpm install --frozen-lockfile

# Run linting
pnpm lint

# Run tests
pnpm test

# Build TypeScript
pnpm build

echo "Build complete!"
