"""Configuration settings using pydantic-settings"""
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application configuration loaded from environment variables"""
    
    # AWS Configuration
    aws_region: str = "us-east-1"
    aws_endpoint_url: str | None = None  # For LocalStack
    public_aws_endpoint_url: str | None = None  # For browser access to LocalStack
    aws_logs_group: str = "/ecs/ephemeral-agent"
    
    # SQS Queues
    sqs_queue_high: str = "bravebird-cua-high.fifo"
    sqs_queue_normal: str = "bravebird-cua-normal.fifo"
    sqs_queue_low: str = "bravebird-cua-low.fifo"
    sqs_dlq: str = "bravebird-cua-high-dlq.fifo"
    
    # DynamoDB
    dynamodb_table: str = "bravebird-jobs"
    dynamodb_rate_limit_table: str = "bravebird-rate-limits"
    dynamodb_sessions_table: str = "bravebird-sessions"
    
    # S3
    s3_bucket: str = "bravebird-artifacts" # Will be suffixed or overridden by env
    
    # ECS
    ecs_cluster: str = "BravebirdCluster"
    ecs_task_definition: str = "CuaWorker"
    ecs_subnets: list[str] = []
    ecs_security_groups: list[str] = []
    
    # Rate Limiting
    rate_limit_per_minute: int = 50
    
    # Job Configuration
    job_timeout_seconds: int = 600  # 10 minutes
    
    class Config:
        env_prefix = "EPHEMERAL_"
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance"""
    return Settings()
