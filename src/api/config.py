"""Configuration settings using pydantic-settings"""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from environment variables"""
    
    # AWS Configuration
    aws_region: str = "us-east-1"
    aws_endpoint_url: str | None = None  # For LocalStack
    
    # SQS Queues
    sqs_queue_high: str = "jobs-high.fifo"
    sqs_queue_normal: str = "jobs-normal.fifo"
    sqs_queue_low: str = "jobs-low.fifo"
    sqs_dlq: str = "jobs-dlq.fifo"
    
    # DynamoDB
    dynamodb_table: str = "jobs"
    dynamodb_rate_limit_table: str = "rate-limits"
    
    # S3
    s3_bucket: str = "job-artifacts"
    
    # ECS
    ecs_cluster: str = "ephemeral-agents"
    ecs_task_definition: str = "agent-task"
    ecs_subnets: list[str] = []
    ecs_security_groups: list[str] = []
    
    # Rate Limiting
    rate_limit_per_minute: int = 10
    
    # Job Configuration
    job_timeout_seconds: int = 600  # 10 minutes
    
    class Config:
        env_prefix = "EPHEMERAL_"
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance"""
    return Settings()
