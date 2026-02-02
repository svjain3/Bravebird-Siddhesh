variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "development"
}

variable "agent_image" {
  description = "Docker image for agent tasks"
  type        = string
  default     = "ephemeral-agent:latest"
}

variable "api_image" {
  description = "Docker image for API service"
  type        = string
  default     = "ephemeral-api:latest"
}

variable "job_timeout_seconds" {
  description = "Maximum job execution time"
  type        = number
  default     = 600
}

variable "rate_limit_per_minute" {
  description = "Max jobs per user per minute"
  type        = number
  default     = 10
}

variable "enable_nat_gateway" {
  description = "Enable NAT gateway for agent internet access (costs ~$32/month)"
  type        = bool
  default     = true
}
