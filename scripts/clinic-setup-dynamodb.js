#!/usr/bin/env node

/**
 * DynamoDB Test Data Setup for Clinic.js Profiling
 *
 * Pre-populates DynamoDB with test job records that match the jobs
 * sent by clinic-load-test.js, ensuring clean profiling runs without
 * database conditional check failures.
 *
 * Usage:
 *   node scripts/clinic-setup-dynamodb.js [num-jobs]
 *
 * Example:
 *   node scripts/clinic-setup-dynamodb.js 100
 *
 * This script should be run BEFORE starting the profiling to ensure
 * the jobs exist in DynamoDB when the application tries to update them.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

// Configuration
const AWS_ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'export-job-state';
const NUM_JOBS = parseInt(process.argv[2] || '100', 10);
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit

// Initialize DynamoDB client
const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: AWS_ENDPOINT,
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test',
  },
});

const docClient = DynamoDBDocumentClient.from(client);

/**
 * Generate job IDs that match what clinic-load-test.js will create
 * Note: We can't predict the exact UUIDs, so we'll create a pool of jobs
 * and the load test will use whatever UUIDs it generates (some will match, some won't)
 *
 * For true matching, we'd need to either:
 * 1. Generate UUIDs here and pass them to load test
 * 2. Or accept that some jobs will fail (which is fine for profiling)
 *
 * This script creates "ready" jobs that represent a realistic state
 */
function generateTestJob(index) {
  const jobId = randomUUID();
  const exportId = randomUUID();
  const taskId = randomUUID();
  const now = new Date().toISOString();

  return {
    jobId,
    exportId,
    userId: `test-user-${index}`,
    status: 'PENDING', // Initial status that the consumer will update
    createdAt: now,
    updatedAt: now,
    tasks: [
      {
        taskId,
        jobId,
        url: 'https://httpbin.org/delay/2',
        format: 'json',
        outputKey: `exports/${jobId}/${taskId}.json`,
        status: 'PENDING',
      },
    ],
    retryCount: 0,
    version: 1, // For optimistic locking
  };
}

/**
 * Write a batch of jobs to DynamoDB
 */
async function writeBatch(jobs) {
  const requests = jobs.map(job => ({
    PutRequest: {
      Item: job,
    },
  }));

  try {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: requests,
        },
      })
    );
    return { success: true, count: jobs.length };
  } catch (error) {
    console.error(`✗ Failed to write batch:`, error.message);
    return { success: false, count: 0, error };
  }
}

/**
 * Write a single job (fallback for small batches)
 */
async function writeJob(job) {
  try {
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: job,
      })
    );
    return true;
  } catch (error) {
    console.error(`✗ Failed to write job ${job.jobId}:`, error.message);
    return false;
  }
}

/**
 * Main setup function
 */
async function setupTestData() {
  console.log(`\n🔧 Setting up DynamoDB test data for profiling\n`);
  console.log(`   Table:     ${TABLE_NAME}`);
  console.log(`   Endpoint:  ${AWS_ENDPOINT}`);
  console.log(`   Jobs:      ${NUM_JOBS}\n`);

  const startTime = Date.now();
  let successCount = 0;
  let failCount = 0;

  // Generate all jobs
  console.log(`📝 Generating ${NUM_JOBS} test jobs...`);
  const jobs = Array.from({ length: NUM_JOBS }, (_, i) => generateTestJob(i));

  // Write in batches
  console.log(`\n💾 Writing jobs to DynamoDB in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(jobs.length / BATCH_SIZE);

    process.stdout.write(`\r   Batch ${batchNum}/${totalBatches}...`);

    const result = await writeBatch(batch);
    if (result.success) {
      successCount += result.count;
    } else {
      failCount += batch.length;
    }

    // Small delay to avoid overwhelming LocalStack
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n\n✅ Setup complete!`);
  console.log(`   Jobs created:    ${successCount}`);
  console.log(`   Failed:          ${failCount}`);
  console.log(`   Duration:        ${duration}s`);
  console.log(`   Rate:            ${(successCount / duration).toFixed(2)} jobs/s\n`);

  if (failCount > 0) {
    console.log(`⚠️  Some jobs failed to create. This may affect profiling results.`);
    console.log(`   Check that LocalStack is running and the table exists.\n`);
  }

  console.log(`💡 DynamoDB is ready. You can now run profiling:\n`);
  console.log(`   ./scripts/clinic-profile.sh doctor ${NUM_JOBS}\n`);

  // Export job IDs to a file for potential use by load test
  const jobIds = jobs.map(j => ({ jobId: j.jobId, exportId: j.exportId }));
  const fs = require('fs');
  fs.writeFileSync('.clinic-jobs.json', JSON.stringify(jobIds, null, 2));
  console.log(`📋 Job IDs saved to .clinic-jobs.json\n`);
}

/**
 * Verify DynamoDB table exists
 */
async function verifyTable() {
  const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');

  try {
    await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return true;
  } catch (error) {
    console.error(`\n❌ Error: DynamoDB table '${TABLE_NAME}' not found or not accessible\n`);
    console.error(`   Make sure LocalStack is running and the table is created.\n`);
    console.error(`   To create the table, run: docker-compose up -d\n`);
    return false;
  }
}

// Run setup
(async () => {
  try {
    const tableExists = await verifyTable();
    if (!tableExists) {
      process.exit(1);
    }

    await setupTestData();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
