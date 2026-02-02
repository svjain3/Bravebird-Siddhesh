# S3 and DynamoDB for Storage

# S3 Bucket for artifacts
resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "ephemeral-artifacts-"
  force_destroy = var.environment != "production"
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  
  rule {
    id     = "cleanup-old-artifacts"
    status = "Enabled"
    
    expiration {
      days = 7
    }
    
    filter {
      prefix = "jobs/"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# DynamoDB - Jobs table
resource "aws_dynamodb_table" "jobs" {
  name         = "jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  
  attribute {
    name = "pk"
    type = "S"
  }
  
  attribute {
    name = "user_id"
    type = "S"
  }
  
  attribute {
    name = "status"
    type = "S"
  }
  
  global_secondary_index {
    name            = "user-index"
    hash_key        = "user_id"
    range_key       = "pk"
    projection_type = "ALL"
  }
  
  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "pk"
    projection_type = "ALL"
  }
  
  point_in_time_recovery {
    enabled = var.environment == "production"
  }
}

# DynamoDB - Rate limits table
resource "aws_dynamodb_table" "rate_limits" {
  name         = "rate-limits"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  
  attribute {
    name = "pk"
    type = "S"
  }
  
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# Secrets Manager
resource "aws_secretsmanager_secret" "agent_credentials" {
  name_prefix = "ephemeral-agent-creds-"
  description = "Credentials injected into agent containers"
}

resource "aws_secretsmanager_secret_version" "agent_credentials" {
  secret_id = aws_secretsmanager_secret.agent_credentials.id
  secret_string = jsonencode({
    API_KEY = "placeholder-replace-in-console"
  })
  
  lifecycle {
    ignore_changes = [secret_string]
  }
}
