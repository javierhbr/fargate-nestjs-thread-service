#!/usr/bin/env node

/**
 * Clinic.js Load Testing Script
 *
 * This script sends test messages to the SQS queue to trigger worker thread
 * processing, allowing Clinic.js to detect blocking operations in the worker pool.
 *
 * Usage:
 *   node scripts/clinic-load-test.js [num-messages]
 *
 * Example:
 *   node scripts/clinic-load-test.js 50
 */

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { randomUUID } = require('crypto');

// Configuration
const AWS_ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const QUEUE_URL = process.env.SQS_EXPORT_JOBS_URL || 'http://sqs.us-east-1.localhost:4566/000000000000/export-jobs';
const NUM_MESSAGES = parseInt(process.argv[2] || '20', 10);
const DELAY_MS = 100; // Delay between messages to avoid overwhelming the queue

// Initialize SQS client
const sqsClient = new SQSClient({
  region: 'us-east-1',
  endpoint: AWS_ENDPOINT,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

/**
 * Generate a test export job message
 */
function generateTestMessage(index) {
  const jobId = randomUUID();
  const exportId = randomUUID();
  const taskId = randomUUID();

  return {
    jobId,
    exportId,
    userId: `test-user-${index}`,
    createdAt: new Date().toISOString(),
    tasks: [
      {
        taskId,
        jobId,
        url: 'https://httpbin.org/delay/2', // 2-second delay to simulate work
        format: 'json',
        outputKey: `exports/${jobId}/${taskId}.json`,
      },
    ],
  };
}

/**
 * Send a single message to SQS
 */
async function sendMessage(message, index) {
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(message),
  });

  try {
    await sqsClient.send(command);
    console.log(`✓ Sent message ${index + 1}/${NUM_MESSAGES} (jobId: ${message.jobId})`);
  } catch (error) {
    console.error(`✗ Failed to send message ${index + 1}:`, error.message);
  }
}

/**
 * Send multiple messages with delay
 */
async function sendMessages() {
  console.log(`\n🚀 Starting load test: Sending ${NUM_MESSAGES} messages to ${QUEUE_URL}\n`);

  const startTime = Date.now();

  for (let i = 0; i < NUM_MESSAGES; i++) {
    const message = generateTestMessage(i);
    await sendMessage(message, i);

    // Add delay between messages
    if (i < NUM_MESSAGES - 1) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Load test complete!`);
  console.log(`   Messages sent: ${NUM_MESSAGES}`);
  console.log(`   Duration: ${duration}s`);
  console.log(`   Rate: ${(NUM_MESSAGES / duration).toFixed(2)} msg/s\n`);
  console.log(`💡 Monitor the application logs to see worker thread processing\n`);
}

// Run the load test
sendMessages().catch(error => {
  console.error('Load test failed:', error);
  process.exit(1);
});
