# DynamoDB table for job state
resource "aws_dynamodb_table" "job_state" {
  name         = "${local.name_prefix}-job-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "jobId"

  attribute {
    name = "jobId"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "userId-index"
    hash_key        = "userId"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name = "${local.name_prefix}-job-state"
  }
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.job_state.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.job_state.arn
}
