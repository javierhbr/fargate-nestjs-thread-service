#!/usr/bin/env node

/**
 * Clear DynamoDB and SQS Data for Clean Profiling
 *
 * Removes all test data from DynamoDB and drains SQS queues to ensure
 * a clean baseline for profiling runs.
 *
 * Usage:
 *   node scripts/clinic-clear-data.js
 *
 * This script should be run BEFORE baseline profiling to ensure no
 * stale data affects the results.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, PurgeQueueCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs');

// Configuration
const AWS_ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'export-job-state';
const EXPORT_JOBS_URL = process.env.SQS_EXPORT_JOBS_URL || 'http://sqs.us-east-1.localhost:4566/000000000000/export-jobs';
const DOWNLOAD_TASKS_URL = process.env.SQS_DOWNLOAD_TASKS_URL || 'http://sqs.us-east-1.localhost:4566/000000000000/download-tasks';

// Initialize clients
const dynamoClient = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: AWS_ENDPOINT,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

const sqsClient = new SQSClient({
  region: 'us-east-1',
  endpoint: AWS_ENDPOINT,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});

/**
 * Clear all items from DynamoDB table
 */
async function clearDynamoDB() {
  console.log(`\n🗑️  Clearing DynamoDB table: ${TABLE_NAME}`);

  try {
    // Scan all items
    const scanResult = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: 'jobId', // Only get the key
      })
    );

    if (!scanResult.Items || scanResult.Items.length === 0) {
      console.log('   ✓ Table is already empty');
      return 0;
    }

    const itemCount = scanResult.Items.length;
    console.log(`   Found ${itemCount} items to delete...`);

    // Delete all items
    let deletedCount = 0;
    for (const item of scanResult.Items) {
      try {
        await docClient.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { jobId: item.jobId },
          })
        );
        deletedCount++;
        process.stdout.write(`\r   Deleted ${deletedCount}/${itemCount} items...`);
      } catch (error) {
        console.error(`\n   ✗ Failed to delete item ${item.jobId}:`, error.message);
      }
    }

    console.log(`\n   ✓ Deleted ${deletedCount} items from DynamoDB`);
    return deletedCount;
  } catch (error) {
    console.error(`   ✗ Failed to clear DynamoDB:`, error.message);
    return 0;
  }
}

/**
 * Purge SQS queue
 */
async function purgeQueue(queueUrl, queueName) {
  console.log(`\n🗑️  Purging SQS queue: ${queueName}`);

  try {
    // Check current message count
    const attrs = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
      })
    );

    const visibleCount = parseInt(attrs.Attributes?.ApproximateNumberOfMessages || '0');
    const inflightCount = parseInt(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible || '0');
    const totalCount = visibleCount + inflightCount;

    if (totalCount === 0) {
      console.log('   ✓ Queue is already empty');
      return;
    }

    console.log(`   Found ${totalCount} messages (${visibleCount} visible, ${inflightCount} in-flight)`);

    // Purge the queue
    await sqsClient.send(
      new PurgeQueueCommand({
        QueueUrl: queueUrl,
      })
    );

    console.log('   ✓ Queue purged successfully');
    console.log('   ℹ️  Note: Messages may take up to 60s to be fully purged');
  } catch (error) {
    if (error.name === 'PurgeQueueInProgress') {
      console.log('   ⚠️  Queue purge already in progress (wait 60s before purging again)');
    } else {
      console.error(`   ✗ Failed to purge queue:`, error.message);
    }
  }
}

/**
 * Main cleanup function
 */
async function cleanup() {
  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(`║  Clinic.js Data Cleanup                                ║`);
  console.log(`╚════════════════════════════════════════════════════════╝`);

  const startTime = Date.now();

  // Clear DynamoDB
  const deletedCount = await clearDynamoDB();

  // Purge SQS queues
  await purgeQueue(EXPORT_JOBS_URL, 'export-jobs');
  await purgeQueue(DOWNLOAD_TASKS_URL, 'download-tasks');

  // Remove generated files
  console.log(`\n🗑️  Removing generated files`);
  const fs = require('fs');
  const filesToRemove = ['.clinic-jobs.json'];

  for (const file of filesToRemove) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`   ✓ Removed ${file}`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ Cleanup complete!`);
  console.log(`   DynamoDB items deleted: ${deletedCount}`);
  console.log(`   Duration: ${duration}s`);
  console.log(`\n💡 Ready for clean baseline profiling:\n`);
  console.log(`   ./scripts/clinic-profile.sh doctor 100\n`);
}

// Run cleanup
cleanup().catch(error => {
  console.error('\n❌ Cleanup failed:', error.message);
  process.exit(1);
});
