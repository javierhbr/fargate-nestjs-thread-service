terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # Configure in backend.hcl or via -backend-config
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Application = var.app_name
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

locals {
  name_prefix = "${var.app_name}-${var.environment}"
}

# Data sources
data "aws_caller_identity" "current" {}

data "aws_vpc" "selected" {
  id = var.vpc_id
}
