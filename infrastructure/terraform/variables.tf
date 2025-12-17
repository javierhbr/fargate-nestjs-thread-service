variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "export-service"
}

variable "vpc_id" {
  description = "VPC ID for the Fargate service"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for Fargate tasks"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs for ALB"
  type        = list(string)
}

variable "container_image" {
  description = "Docker image for the export service"
  type        = string
}

variable "container_cpu" {
  description = "CPU units for the container (1024 = 1 vCPU)"
  type        = number
  default     = 2048
}

variable "container_memory" {
  description = "Memory for the container in MB"
  type        = number
  default     = 4096
}

variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
  default     = 2
}

variable "min_capacity" {
  description = "Minimum number of tasks for auto-scaling"
  type        = number
  default     = 1
}

variable "max_capacity" {
  description = "Maximum number of tasks for auto-scaling"
  type        = number
  default     = 10
}

variable "export_api_base_url" {
  description = "Base URL for the export API"
  type        = string
}

variable "worker_pool_size" {
  description = "Number of worker threads in the pool"
  type        = number
  default     = 4
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
