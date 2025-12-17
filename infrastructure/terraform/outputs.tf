output "cluster_arn" {
  description = "ECS Cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "service_arn" {
  description = "ECS Service ARN"
  value       = aws_ecs_service.app.id
}

output "task_definition_arn" {
  description = "Task Definition ARN"
  value       = aws_ecs_task_definition.app.arn
}

output "task_role_arn" {
  description = "Task Role ARN"
  value       = aws_iam_role.task.arn
}

output "log_group_name" {
  description = "CloudWatch Log Group Name"
  value       = aws_cloudwatch_log_group.app.name
}

output "security_group_id" {
  description = "Security Group ID"
  value       = aws_security_group.app.id
}
