# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm run build

# Prune dev dependencies
RUN pnpm prune --prod

# Production stage
FROM node:20-alpine AS production

# Add labels
LABEL maintainer="Export Service Team"
LABEL description="Hybrid Export Processing Service"

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Copy built application
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

# Create temp directory for file processing
RUN mkdir -p /tmp/exports && chown -R nestjs:nodejs /tmp/exports

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV TEMP_DIR=/tmp/exports

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

# Start the application
CMD ["node", "dist/main.js"]
