"""AWS service clients with LocalStack support"""
import boto3
from functools import lru_cache
from .config import get_settings


@lru_cache
def get_sqs_client():
    """Get SQS client (uses LocalStack endpoint if configured)"""
    settings = get_settings()
    return boto3.client(
        "sqs",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )


@lru_cache
def get_dynamodb_client():
    """Get DynamoDB client"""
    settings = get_settings()
    return boto3.client(
        "dynamodb",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )


@lru_cache
def get_s3_client():
    """Get S3 client"""
    settings = get_settings()
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )


@lru_cache
def get_ecs_client():
    """Get ECS client"""
    settings = get_settings()
    return boto3.client(
        "ecs",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )


@lru_cache
def get_logs_client():
    """Get CloudWatch Logs client"""
    settings = get_settings()
    return boto3.client(
        "logs",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )


@lru_cache
def get_secretsmanager_client():
    """Get Secrets Manager client"""
    settings = get_settings()
    return boto3.client(
        "secretsmanager",
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url,
    )
