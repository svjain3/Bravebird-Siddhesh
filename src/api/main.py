"""FastAPI application - Main entry point"""
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    Job, JobInput, JobStatus, JobSubmitResponse, JobStatusResponse,
    HealthResponse, Priority, JobResult
)
from .config import get_settings
from .aws_clients import get_sqs_client, get_dynamodb_client, get_s3_client, get_logs_client


# Queue URLs cache
_queue_urls: dict[str, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """Application lifespan - setup and teardown"""
    settings = get_settings()
    sqs = get_sqs_client()
    
    # Cache queue URLs
    for priority, queue_name in [
        (Priority.HIGH, settings.sqs_queue_high),
        (Priority.NORMAL, settings.sqs_queue_normal),
        (Priority.LOW, settings.sqs_queue_low),
    ]:
        try:
            response = sqs.get_queue_url(QueueName=queue_name)
            _queue_urls[priority.value] = response["QueueUrl"]
        except Exception:
            # Queue may not exist in LocalStack yet
            _queue_urls[priority.value] = f"http://localhost:4566/000000000000/{queue_name}"
    
    yield
    # Cleanup if needed


app = FastAPI(
    title="Ephemeral Environment API",
    description="Orchestration system for Computer Use tasks",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def check_rate_limit(user_id: str) -> bool:
    """Check if user is within rate limit (10 jobs/min)"""
    from botocore.exceptions import ClientError
    
    settings = get_settings()
    dynamodb = get_dynamodb_client()
    
    # Key: user_id + current minute
    minute_key = datetime.utcnow().strftime("%Y%m%d%H%M")
    pk = f"rate:{user_id}:{minute_key}"
    
    try:
        response = dynamodb.update_item(
            TableName=settings.dynamodb_rate_limit_table,
            Key={"pk": {"S": pk}},
            UpdateExpression="SET #count = if_not_exists(#count, :zero) + :inc",
            ExpressionAttributeNames={"#count": "count"},
            ExpressionAttributeValues={
                ":inc": {"N": "1"},
                ":zero": {"N": "0"},
                ":limit": {"N": str(settings.rate_limit_per_minute)},
            },
            ConditionExpression="attribute_not_exists(#count) OR #count < :limit",
            ReturnValues="UPDATED_NEW",
        )
        return True
    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        # If rate limit table doesn't exist or other error, allow the request
        return True
    except Exception:
        # Fallback - allow the request
        return True


async def save_job(job: Job) -> None:
    """Save job to DynamoDB"""
    settings = get_settings()
    dynamodb = get_dynamodb_client()
    
    try:
        dynamodb.put_item(
            TableName=settings.dynamodb_table,
            Item=job.to_dynamodb_item(),
        )
    except Exception as e:
        # Log but don't fail - job is already queued
        print(f"Warning: Failed to save job to DynamoDB: {e}")


async def get_job(job_id: str) -> Job | None:
    """Get job from DynamoDB"""
    settings = get_settings()
    dynamodb = get_dynamodb_client()
    
    try:
        response = dynamodb.get_item(
            TableName=settings.dynamodb_table,
            Key={"pk": {"S": job_id}},
        )
        if "Item" in response:
            return Job.from_dynamodb_item(response["Item"])
    except Exception as e:
        print(f"Warning: Failed to get job from DynamoDB: {e}")
    return None


async def enqueue_job(job: Job) -> None:
    """Send job to appropriate SQS queue"""
    sqs = get_sqs_client()
    queue_url = _queue_urls.get(job.priority.value)
    
    if not queue_url:
        raise HTTPException(500, "Queue not configured")
    
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=job.model_dump_json(),
        MessageGroupId=job.user_id,  # FIFO ordering per user
        MessageDeduplicationId=job.job_id,
    )


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    settings = get_settings()
    services = {}
    
    # Check SQS
    try:
        sqs = get_sqs_client()
        sqs.list_queues(MaxResults=1)
        services["sqs"] = "ok"
    except Exception as e:
        print(f"Health check SQS error: {e}")
        services["sqs"] = "error"
    
    # Check DynamoDB
    try:
        dynamodb = get_dynamodb_client()
        dynamodb.list_tables(Limit=1)
        services["dynamodb"] = "ok"
    except Exception as e:
        print(f"Health check DynamoDB error: {e}")
        services["dynamodb"] = "error"
    
    # Check S3
    try:
        s3 = get_s3_client()
        s3.list_buckets()
        services["s3"] = "ok"
    except Exception as e:
        print(f"Health check S3 error: {e}")
        services["s3"] = "error"
    
    return HealthResponse(services=services)


@app.post("/jobs", response_model=JobSubmitResponse)
async def submit_job(job_input: JobInput):
    """Submit a new job for execution"""
    
    # Check rate limit
    if not await check_rate_limit(job_input.user_id):
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Max {get_settings().rate_limit_per_minute} jobs per minute.",
        )
    
    # Create job
    job = Job(
        user_id=job_input.user_id,
        url=job_input.url,
        priority=job_input.priority,
        timeout_seconds=job_input.timeout_seconds,
        metadata=job_input.metadata,
        status=JobStatus.QUEUED,
    )
    
    # Save to DynamoDB
    await save_job(job)
    
    # Enqueue to SQS
    await enqueue_job(job)
    
    return JobSubmitResponse(
        job_id=job.job_id,
        status=job.status,
    )


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    """Get job status and results"""
    job = await get_job(job_id)
    
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")
    
    # Generate pre-signed URL for screenshot if available
    if job.result and job.result.screenshot_url:
        settings = get_settings()
        s3 = get_s3_client()
        try:
            # Extract key from URL or use stored key
            key = f"jobs/{job_id}/screenshot.png"
            presigned_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.s3_bucket, "Key": key},
                ExpiresIn=3600,
            )
            
            # If public endpoint is configured, swap it in the URL
            if settings.public_aws_endpoint_url and settings.aws_endpoint_url:
                presigned_url = presigned_url.replace(
                    settings.aws_endpoint_url, 
                    settings.public_aws_endpoint_url
                )
            
            job.result.screenshot_url = presigned_url
        except Exception:
            pass
    
    return JobStatusResponse(
        job_id=job.job_id,
        status=job.status,
        url=job.url,
        priority=job.priority,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        result=job.result,
    )


@app.delete("/jobs/{job_id}")
async def cancel_job(job_id: str):
    """Cancel a pending or running job"""
    settings = get_settings()
    dynamodb = get_dynamodb_client()
    
    job = await get_job(job_id)
    if not job:
        raise HTTPException(404, f"Job {job_id} not found")
    
    if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
        raise HTTPException(400, f"Job {job_id} already finished")
    
    # Update status
    try:
        dynamodb.update_item(
            TableName=settings.dynamodb_table,
            Key={"pk": {"S": job_id}},
            UpdateExpression="SET #status = :status, completed_at = :now",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": {"S": JobStatus.CANCELLED.value},
                ":now": {"S": datetime.utcnow().isoformat()},
            },
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to cancel job: {e}")
    
    # TODO: If running, stop ECS task
    
    return {"job_id": job_id, "status": "cancelled"}


@app.websocket("/jobs/{job_id}/logs")
async def stream_logs(websocket: WebSocket, job_id: str):
    """Stream job logs in real-time via WebSocket"""
    await websocket.accept()
    
    settings = get_settings()
    logs = get_logs_client()
    log_group = settings.aws_logs_group
    
    next_token = None
    
    try:
        while True:
            try:
                kwargs = {
                    "logGroupName": log_group,
                    "startFromHead": False,
                    "limit": 100,
                    "filterPattern": f"[{job_id}]",
                }
                if next_token:
                    kwargs["nextToken"] = next_token
                
                response = logs.filter_log_events(**kwargs)
                
                for event in response.get("events", []):
                    await websocket.send_json({
                        "timestamp": event["timestamp"],
                        "message": event["message"],
                    })
                
                # Update token for next poll
                next_token = response.get("nextToken") or response.get("nextForwardToken")
                
                # Check if job is complete
                job = await get_job(job_id)
                if job and job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                    await websocket.send_json({"status": "complete", "job_status": job.status.value})
                    break
                
            except Exception as e:
                # Handle group not found or other API errors gracefully
                error_name = getattr(e, "response", {}).get("Error", {}).get("Code", "UnknownError")
                if error_name == "ResourceNotFoundException":
                    await websocket.send_json({"status": "waiting", "message": "Waiting for logs..."})
                else:
                    await websocket.send_json({"status": "error", "message": f"Log error: {str(e)}"})
                    break
            
            import asyncio
            await asyncio.sleep(2)
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"status": "error", "message": f"Stream error: {str(e)}"})
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
