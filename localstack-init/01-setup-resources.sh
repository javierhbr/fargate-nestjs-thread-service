#!/bin/bash

echo "Setting up LocalStack resources for export-service..."

# Set AWS endpoint and credentials for LocalStack
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
ENDPOINT_URL=http://localhost:4566

# Create S3 bucket
echo "Creating S3 bucket..."
aws --endpoint-url=$ENDPOINT_URL s3 mb s3://export-output-bucket
aws --endpoint-url=$ENDPOINT_URL s3api put-bucket-versioning \
  --bucket export-output-bucket \
  --versioning-configuration Status=Enabled

echo "S3 bucket created: export-output-bucket"

# Create SQS queues
echo "Creating SQS queues..."

# Export Jobs Queue
aws --endpoint-url=$ENDPOINT_URL sqs create-queue \
  --queue-name export-jobs \
  --attributes VisibilityTimeout=900,MessageRetentionPeriod=1209600

# Download Tasks Queue
aws --endpoint-url=$ENDPOINT_URL sqs create-queue \
  --queue-name download-tasks \
  --attributes VisibilityTimeout=900,MessageRetentionPeriod=1209600

# Get queue URLs
EXPORT_JOBS_URL=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-url --queue-name export-jobs --query 'QueueUrl' --output text)
DOWNLOAD_TASKS_URL=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-url --queue-name download-tasks --query 'QueueUrl' --output text)

echo "SQS queues created:"
echo "  Export Jobs Queue: $EXPORT_JOBS_URL"
echo "  Download Tasks Queue: $DOWNLOAD_TASKS_URL"

# Create DynamoDB table
echo "Creating DynamoDB table..."
aws --endpoint-url=$ENDPOINT_URL dynamodb create-table \
  --table-name export-job-state \
  --attribute-definitions \
    AttributeName=jobId,AttributeType=S \
    AttributeName=exportId,AttributeType=S \
  --key-schema \
    AttributeName=jobId,KeyType=HASH \
  --global-secondary-indexes \
    '[{
      "IndexName": "exportId-index",
      "KeySchema": [{"AttributeName":"exportId","KeyType":"HASH"}],
      "Projection": {"ProjectionType":"ALL"},
      "ProvisionedThroughput": {"ReadCapacityUnits":5,"WriteCapacityUnits":5}
    }]' \
  --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5

echo "DynamoDB table created: export-job-state"

# Create Dead Letter Queues (optional but recommended)
echo "Creating Dead Letter Queues..."

aws --endpoint-url=$ENDPOINT_URL sqs create-queue \
  --queue-name export-jobs-dlq \
  --attributes MessageRetentionPeriod=1209600

aws --endpoint-url=$ENDPOINT_URL sqs create-queue \
  --queue-name download-tasks-dlq \
  --attributes MessageRetentionPeriod=1209600

DLQ_EXPORT_URL=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-url --queue-name export-jobs-dlq --query 'QueueUrl' --output text)
DLQ_DOWNLOAD_URL=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-url --queue-name download-tasks-dlq --query 'QueueUrl' --output text)

# Get DLQ ARNs
DLQ_EXPORT_ARN=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-attributes --queue-url "$DLQ_EXPORT_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)
DLQ_DOWNLOAD_ARN=$(aws --endpoint-url=$ENDPOINT_URL sqs get-queue-attributes --queue-url "$DLQ_DOWNLOAD_URL" --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

# Configure redrive policy for main queues
aws --endpoint-url=$ENDPOINT_URL sqs set-queue-attributes \
  --queue-url "$EXPORT_JOBS_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_EXPORT_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

aws --endpoint-url=$ENDPOINT_URL sqs set-queue-attributes \
  --queue-url "$DOWNLOAD_TASKS_URL" \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_DOWNLOAD_ARN\\\",\\\"maxReceiveCount\\\":\\\"3\\\"}\"}"

echo "Dead Letter Queues configured"

echo ""
echo "========================================="
echo "LocalStack setup complete!"
echo "========================================="
echo ""
echo "Update your .env file with these values:"
echo ""
echo "SQS_EXPORT_JOBS_URL=$EXPORT_JOBS_URL"
echo "SQS_DOWNLOAD_TASKS_URL=$DOWNLOAD_TASKS_URL"
echo ""
echo "AWS services available at: http://localhost:4566"
echo ""
