#!/usr/bin/env node

/**
 * SQS Queue Monitoring Script
 * Real-time monitoring of SQS queue metrics during Clinic.js profiling
 *
 * Usage:
 *   node scripts/monitor-queue.js [poll-interval-ms]
 *
 * Examples:
 *   node scripts/monitor-queue.js           # Poll every 2 seconds
 *   node scripts/monitor-queue.js 1000      # Poll every 1 second
 *   npm run clinic:monitor                  # Using npm script
 *
 * Environment Variables:
 *   AWS_ENDPOINT           - LocalStack endpoint (default: http://localhost:4566)
 *   SQS_EXPORT_JOBS_URL    - Export jobs queue URL
 *   SQS_DOWNLOAD_TASKS_URL - Download tasks queue URL (optional)
 *   AWS_REGION             - AWS region (default: us-east-1)
 *   AWS_ACCESS_KEY_ID      - AWS access key (default: test)
 *   AWS_SECRET_ACCESS_KEY  - AWS secret key (default: test)
 */

const { SQSClient, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

// Configuration from environment
const config = {
  endpoint: process.env.AWS_ENDPOINT || 'http://localhost:4566',
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
  },
  exportJobsQueueUrl:
    process.env.SQS_EXPORT_JOBS_URL ||
    'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/export-jobs',
  downloadTasksQueueUrl: process.env.SQS_DOWNLOAD_TASKS_URL,
  pollInterval: parseInt(process.argv[2]) || 2000, // Default 2 seconds
};

// Create SQS client
const sqs = new SQSClient({
  endpoint: config.endpoint,
  region: config.region,
  credentials: config.credentials,
});

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

// Previous metrics for rate calculation
const previousMetrics = new Map();
let iterationCount = 0;

/**
 * Get queue attributes
 */
async function getQueueMetrics(queueUrl, queueName) {
  const command = new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: [
      'ApproximateNumberOfMessages',
      'ApproximateNumberOfMessagesNotVisible',
      'ApproximateNumberOfMessagesDelayed',
    ],
  });

  try {
    const response = await sqs.send(command);
    const attrs = response.Attributes;

    return {
      name: queueName,
      visible: parseInt(attrs.ApproximateNumberOfMessages) || 0,
      inFlight: parseInt(attrs.ApproximateNumberOfMessagesNotVisible) || 0,
      delayed: parseInt(attrs.ApproximateNumberOfMessagesDelayed) || 0,
      total:
        (parseInt(attrs.ApproximateNumberOfMessages) || 0) +
        (parseInt(attrs.ApproximateNumberOfMessagesNotVisible) || 0) +
        (parseInt(attrs.ApproximateNumberOfMessagesDelayed) || 0),
    };
  } catch (error) {
    return {
      name: queueName,
      error: error.message,
      visible: 0,
      inFlight: 0,
      delayed: 0,
      total: 0,
    };
  }
}

/**
 * Calculate processing rate
 */
function calculateRate(queueName, currentTotal) {
  const key = `${queueName}_total`;
  const previous = previousMetrics.get(key);

  if (previous === undefined) {
    previousMetrics.set(key, currentTotal);
    return 0;
  }

  const diff = previous - currentTotal; // Messages processed (total decreased)
  const ratePerSecond = (diff / (config.pollInterval / 1000)).toFixed(1);

  previousMetrics.set(key, currentTotal);

  return parseFloat(ratePerSecond);
}

/**
 * Format number with color based on threshold
 */
function formatNumber(value, thresholds) {
  let color = colors.green;

  if (thresholds) {
    if (value >= thresholds.critical) {
      color = colors.red + colors.bright;
    } else if (value >= thresholds.warning) {
      color = colors.yellow;
    }
  }

  return `${color}${value.toString().padStart(6)}${colors.reset}`;
}

/**
 * Format rate with color and direction
 */
function formatRate(rate) {
  if (rate > 0) {
    return `${colors.green}↓ ${rate.toFixed(1).padStart(5)}/s${colors.reset}`;
  } else if (rate < 0) {
    return `${colors.red}↑ ${Math.abs(rate).toFixed(1).padStart(5)}/s${colors.reset}`;
  } else {
    return `${colors.dim}  ${rate.toFixed(1).padStart(5)}/s${colors.reset}`;
  }
}

/**
 * Display metrics
 */
async function displayMetrics() {
  const timestamp = new Date().toISOString().substring(11, 19);
  iterationCount++;

  // Clear screen (move cursor to top)
  if (iterationCount > 1) {
    process.stdout.write('\x1b[H');
  }

  // Header
  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║  SQS Queue Monitor - Real-time Metrics         ${colors.dim}[${timestamp}]${colors.cyan}          ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════════════════════╝${colors.reset}`);
  console.log('');

  // Column headers
  console.log(
    `${colors.bright}Queue${colors.reset}`.padEnd(35) +
      `${colors.bright}Visible${colors.reset}`.padStart(8) +
      `${colors.bright}In-Flight${colors.reset}`.padStart(12) +
      `${colors.bright}Delayed${colors.reset}`.padStart(10) +
      `${colors.bright}Total${colors.reset}`.padStart(8) +
      `${colors.bright}Rate${colors.reset}`.padStart(14)
  );
  console.log('─'.repeat(88));

  // Export Jobs Queue
  const exportJobsMetrics = await getQueueMetrics(config.exportJobsQueueUrl, 'export-jobs');

  if (exportJobsMetrics.error) {
    console.log(`${colors.red}Error: ${exportJobsMetrics.error}${colors.reset}`);
  } else {
    const rate = calculateRate('export-jobs', exportJobsMetrics.total);

    console.log(
      `${colors.blue}${exportJobsMetrics.name}${colors.reset}`.padEnd(35) +
        formatNumber(exportJobsMetrics.visible, { warning: 50, critical: 100 }) +
        '  ' +
        formatNumber(exportJobsMetrics.inFlight, { warning: 10, critical: 20 }) +
        '  ' +
        formatNumber(exportJobsMetrics.delayed) +
        '  ' +
        formatNumber(exportJobsMetrics.total, { warning: 60, critical: 120 }) +
        '  ' +
        formatRate(rate)
    );
  }

  // Download Tasks Queue (if configured)
  if (config.downloadTasksQueueUrl) {
    const downloadTasksMetrics = await getQueueMetrics(
      config.downloadTasksQueueUrl,
      'download-tasks'
    );

    if (downloadTasksMetrics.error) {
      console.log(`${colors.red}Error: ${downloadTasksMetrics.error}${colors.reset}`);
    } else {
      const rate = calculateRate('download-tasks', downloadTasksMetrics.total);

      console.log(
        `${colors.blue}${downloadTasksMetrics.name}${colors.reset}`.padEnd(35) +
          formatNumber(downloadTasksMetrics.visible, { warning: 100, critical: 200 }) +
          '  ' +
          formatNumber(downloadTasksMetrics.inFlight, { warning: 20, critical: 40 }) +
          '  ' +
          formatNumber(downloadTasksMetrics.delayed) +
          '  ' +
          formatNumber(downloadTasksMetrics.total, { warning: 120, critical: 240 }) +
          '  ' +
          formatRate(rate)
      );
    }
  }

  console.log('');

  // Legend
  console.log(`${colors.dim}Legend:${colors.reset}`);
  console.log(
    `  ${colors.dim}Visible:${colors.reset}   Messages available for processing`
  );
  console.log(
    `  ${colors.dim}In-Flight:${colors.reset} Messages currently being processed`
  );
  console.log(
    `  ${colors.dim}Delayed:${colors.reset}   Messages with delay timer`
  );
  console.log(
    `  ${colors.dim}Total:${colors.reset}     Sum of all messages in queue`
  );
  console.log(
    `  ${colors.dim}Rate:${colors.reset}      Messages/second (↓=processing, ↑=adding)`
  );
  console.log('');

  // Instructions
  console.log(
    `${colors.dim}Press ${colors.bright}Ctrl+C${colors.reset}${colors.dim} to stop monitoring${colors.reset}`
  );
}

/**
 * Main monitoring loop
 */
async function startMonitoring() {
  // Clear screen
  console.clear();

  // Display initial banner
  console.log(`${colors.bright}${colors.green}Starting SQS Queue Monitoring...${colors.reset}`);
  console.log(`${colors.dim}Poll interval: ${config.pollInterval}ms${colors.reset}`);
  console.log('');

  // Initial display
  await displayMetrics();

  // Set up polling
  setInterval(async () => {
    await displayMetrics();
  }, config.pollInterval);
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
  console.log('\n');
  console.log(`${colors.green}Monitoring stopped.${colors.reset}`);
  process.exit(0);
});

// Start monitoring
startMonitoring().catch((error) => {
  console.error(`${colors.red}Failed to start monitoring:${colors.reset}`, error);
  process.exit(1);
});
