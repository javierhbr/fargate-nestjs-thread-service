# Export Jobs Queue (SQS 1)
resource "aws_sqs_queue" "export_jobs_dlq" {
  name                      = "${local.name_prefix}-export-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "${local.name_prefix}-export-jobs-dlq"
  }
}

resource "aws_sqs_queue" "export_jobs" {
  name                       = "${local.name_prefix}-export-jobs"
  visibility_timeout_seconds = 900  # 15 minutes
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.export_jobs_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${local.name_prefix}-export-jobs"
  }
}

# Download Tasks Queue (SQS 2 - Overflow)
resource "aws_sqs_queue" "download_tasks_dlq" {
  name                      = "${local.name_prefix}-download-tasks-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name = "${local.name_prefix}-download-tasks-dlq"
  }
}

resource "aws_sqs_queue" "download_tasks" {
  name                       = "${local.name_prefix}-download-tasks"
  visibility_timeout_seconds = 900  # 15 minutes
  message_retention_seconds  = 86400 # 1 day
  receive_wait_time_seconds  = 20    # Long polling

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.download_tasks_dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "${local.name_prefix}-download-tasks"
  }
}

# CloudWatch Alarms for DLQ
resource "aws_cloudwatch_metric_alarm" "export_jobs_dlq_alarm" {
  alarm_name          = "${local.name_prefix}-export-jobs-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when messages appear in export jobs DLQ"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.export_jobs_dlq.name
  }

  tags = {
    Name = "${local.name_prefix}-export-jobs-dlq-alarm"
  }
}

resource "aws_cloudwatch_metric_alarm" "download_tasks_dlq_alarm" {
  alarm_name          = "${local.name_prefix}-download-tasks-dlq-messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Alert when messages appear in download tasks DLQ"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.download_tasks_dlq.name
  }

  tags = {
    Name = "${local.name_prefix}-download-tasks-dlq-alarm"
  }
}

output "export_jobs_queue_url" {
  value = aws_sqs_queue.export_jobs.url
}

output "export_jobs_queue_arn" {
  value = aws_sqs_queue.export_jobs.arn
}

output "download_tasks_queue_url" {
  value = aws_sqs_queue.download_tasks.url
}

output "download_tasks_queue_arn" {
  value = aws_sqs_queue.download_tasks.arn
}
