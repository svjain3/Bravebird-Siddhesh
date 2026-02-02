output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "private_subnets" {
  description = "Private subnet IDs"
  value       = module.vpc.private_subnets
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "sqs_queue_urls" {
  description = "SQS queue URLs"
  value = {
    high   = aws_sqs_queue.jobs_high.url
    normal = aws_sqs_queue.jobs_normal.url
    low    = aws_sqs_queue.jobs_low.url
    dlq    = aws_sqs_queue.dlq.url
  }
}

output "s3_bucket" {
  description = "S3 bucket for artifacts"
  value       = aws_s3_bucket.artifacts.id
}

output "dynamodb_tables" {
  description = "DynamoDB table names"
  value = {
    jobs        = aws_dynamodb_table.jobs.name
    rate_limits = aws_dynamodb_table.rate_limits.name
  }
}

output "agent_security_group" {
  description = "Security group ID for agent tasks"
  value       = aws_security_group.agent.id
}

output "api_endpoint" {
  description = "API endpoint URL"
  value       = "http://${aws_lb.api.dns_name}"
}
