# S3 bucket for export output
resource "aws_s3_bucket" "export_output" {
  bucket = "${local.name_prefix}-export-output-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name = "${local.name_prefix}-export-output"
  }
}

resource "aws_s3_bucket_versioning" "export_output" {
  bucket = aws_s3_bucket.export_output.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "export_output" {
  bucket = aws_s3_bucket.export_output.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "export_output" {
  bucket = aws_s3_bucket.export_output.id

  rule {
    id     = "cleanup-old-exports"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

resource "aws_s3_bucket_public_access_block" "export_output" {
  bucket = aws_s3_bucket.export_output.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "s3_bucket_name" {
  value = aws_s3_bucket.export_output.bucket
}

output "s3_bucket_arn" {
  value = aws_s3_bucket.export_output.arn
}
