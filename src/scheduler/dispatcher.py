"""Lambda Dispatcher - Triggered by SQS, launches Fargate tasks"""
import json
import os
from datetime import datetime

import boto3


def get_ecs_client():
    """Get ECS client"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL")
    return boto3.client("ecs", endpoint_url=endpoint_url)


def get_dynamodb_client():
    """Get DynamoDB client"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL")
    return boto3.client("dynamodb", endpoint_url=endpoint_url)


def get_secretsmanager_client():
    """Get Secrets Manager client"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL")
    return boto3.client("secretsmanager", endpoint_url=endpoint_url)


def update_job_status(job_id: str, status: str, task_arn: str = None):
    """Update job status in DynamoDB"""
    dynamodb = get_dynamodb_client()
    table_name = os.environ.get("DYNAMODB_TABLE", "jobs")
    
    update_expr = "SET #status = :status, started_at = :now"
    expr_values = {
        ":status": {"S": status},
        ":now": {"S": datetime.utcnow().isoformat()},
    }
    
    if task_arn:
        update_expr += ", task_arn = :task_arn"
        expr_values[":task_arn"] = {"S": task_arn}
    
    dynamodb.update_item(
        TableName=table_name,
        Key={"pk": {"S": job_id}},
        UpdateExpression=update_expr,
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues=expr_values,
    )


def run_fargate_task(job: dict) -> str:
    """Launch a Fargate task for the job"""
    ecs = get_ecs_client()
    
    cluster = os.environ.get("ECS_CLUSTER", "ephemeral-agents")
    task_definition = os.environ.get("ECS_TASK_DEFINITION", "agent-task")
    subnets = os.environ.get("ECS_SUBNETS", "").split(",")
    security_groups = os.environ.get("ECS_SECURITY_GROUPS", "").split(",")
    
    # Get secret ARN for injection
    secret_arn = os.environ.get("AGENT_SECRET_ARN", "")
    
    response = ecs.run_task(
        cluster=cluster,
        taskDefinition=task_definition,
        # Use capacity provider strategy for Fargate Spot (can't also use launchType)
        capacityProviderStrategy=[
            {
                "capacityProvider": "FARGATE_SPOT",
                "weight": 4,
                "base": 0,
            },
            {
                "capacityProvider": "FARGATE",
                "weight": 1,
                "base": 1,
            },
        ],
        networkConfiguration={
            "awsvpcConfiguration": {
                "subnets": [s for s in subnets if s],
                "securityGroups": [sg for sg in security_groups if sg],
                "assignPublicIp": "DISABLED",  # Private subnet
            }
        },
        overrides={
            "containerOverrides": [
                {
                    "name": "agent",
                    "environment": [
                        {"name": "JOB_ID", "value": job["job_id"]},
                        {"name": "TARGET_URL", "value": job["url"]},
                        {"name": "TIMEOUT_SECONDS", "value": str(job.get("timeout_seconds", 600))},
                    ],
                    # Secrets are injected via task definition, not here
                }
            ],
        },
        # StopTimeout is set in task definition - 10 min max
    )
    
    if response["tasks"]:
        return response["tasks"][0]["taskArn"]
    elif response["failures"]:
        raise Exception(f"Failed to start task: {response['failures']}")
    else:
        raise Exception("No tasks started, no failures reported")


def handler(event: dict, context) -> dict:
    """Lambda handler - Process SQS messages and launch Fargate tasks"""
    
    processed = 0
    failed = 0
    
    for record in event.get("Records", []):
        try:
            # Parse job from SQS message
            job = json.loads(record["body"])
            job_id = job["job_id"]
            
            print(f"Processing job: {job_id}")
            
            # Update status to running
            update_job_status(job_id, "running")
            
            # Launch Fargate task
            task_arn = run_fargate_task(job)
            
            # Update with task ARN
            update_job_status(job_id, "running", task_arn)
            
            print(f"Started task {task_arn} for job {job_id}")
            processed += 1
            
        except Exception as e:
            print(f"Error processing job: {e}")
            # Job will go to DLQ after 3 retries (configured in SQS)
            failed += 1
            raise  # Re-raise to trigger retry
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "processed": processed,
            "failed": failed,
        }),
    }


# For local testing
if __name__ == "__main__":
    # Test with sample event
    test_event = {
        "Records": [
            {
                "body": json.dumps({
                    "job_id": "job-test-123",
                    "url": "https://example.com",
                    "timeout_seconds": 300,
                })
            }
        ]
    }
    print(handler(test_event, None))
