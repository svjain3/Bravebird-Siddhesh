"""FastAPI application - Main entry point"""
import json
from contextlib import asynccontextmanager
from datetime import datetime
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    Job, JobInput, JobStatus, JobSubmitResponse, JobStatusResponse,
    HealthResponse, Priority, JobResult, EligibilityRequest, EligibilityResponse
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
            # Try to get real URL from AWS
            print(f"Resolving Queue URL for: {queue_name}")
            response = sqs.get_queue_url(QueueName=queue_name)
            _queue_urls[priority.value] = response["QueueUrl"]
            print(f"Resolved {queue_name} to {_queue_urls[priority.value]}")
        except Exception as e:
            print(f"Warning: Failed to get queue url for {queue_name}: {e}")
            if settings.aws_endpoint_url:
                # Use LocalStack format
                _queue_urls[priority.value] = f"{settings.aws_endpoint_url}/000000000000/{queue_name}"
            else:
                # Last resort fallback (AWS standard format if account ID was known)
                # But we'll try to resolve it lazily if needed
                pass
    
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


async def get_job(job_id: str, user_id: str | None = None) -> Job | None:
    """Get job from DynamoDB"""
    settings = get_settings()
    dynamodb = get_dynamodb_client()
    
    try:
        if user_id:
            # Efficient point read
            response = dynamodb.get_item(
                TableName=settings.dynamodb_table,
                Key={
                    "PK": {"S": f"TENANT#{user_id}#JOB#{job_id}"},
                    "SK": {"S": "META"}
                },
            )
        else:
            # fallback to Scan if user_id is missing (should add GSI for this!)
            print(f"Warning: get_job called without user_id, performing Scan for job_id={job_id}")
            response = dynamodb.scan(
                TableName=settings.dynamodb_table,
                FilterExpression="job_id = :jid",
                ExpressionAttributeValues={":jid": {"S": job_id}},
                Limit=1
            )
            if response.get("Items"):
                return Job.from_dynamodb_item(response["Items"][0])
            return None

        if "Item" in response:
            return Job.from_dynamodb_item(response["Item"])
    except Exception as e:
        print(f"Warning: Failed to get job from DynamoDB: {e}")
    return None


async def enqueue_job(job: Job) -> None:
    """Send job to appropriate SQS queue"""
    sqs = get_sqs_client()
    settings = get_settings()
    queue_url = _queue_urls.get(job.priority.value)
    
    if not queue_url:
        # Lazy resolution
        queue_name = getattr(settings, f"sqs_queue_{job.priority.value}")
        try:
            response = sqs.get_queue_url(QueueName=queue_name)
            queue_url = response["QueueUrl"]
            _queue_urls[job.priority.value] = queue_url
        except Exception as e:
            print(f"Error resolving queue url lazily: {e}")
            raise HTTPException(500, f"Queue {queue_name} not found")
    
    print(f"Enqueuing job {job.job_id} to {queue_url}")
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
                    "limit": 100,
                    "filterPattern": f'"{job_id}"',
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
                next_token = response.get("nextToken")
                
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

# ---------------------------------------------------------------------------
# MOCK ELIGIBILITY DATA & ENDPOINTS with HOSPITAL SCOPING
# ---------------------------------------------------------------------------

# 15 Mock Patients across 3 Hospitals
MOCK_PATIENTS = {
    # Mercy General (101-105)
    "101": {"name": "Alice Smith", "dob": "1985-04-12", "hospital": "Mercy General", "plan": "Gold PPO", "status": "Active", "copay": "$25"},
    "102": {"name": "Bob Jones", "dob": "1990-06-23", "hospital": "Mercy General", "plan": "Silver HMO", "status": "Active", "copay": "$40"},
    "103": {"name": "Charlie Day", "dob": "1978-11-05", "hospital": "Mercy General", "plan": "Bronze EPO", "status": "Inactive", "copay": "N/A"},
    "104": {"name": "Diana Ross", "dob": "1965-02-14", "hospital": "Mercy General", "plan": "Platinum PPO", "status": "Active", "copay": "$10"},
    "105": {"name": "Edward Norton", "dob": "1988-09-30", "hospital": "Mercy General", "plan": "Gold PPO", "status": "Active", "copay": "$25"},
    
    # St. Jude Medical (106-110)
    "106": {"name": "Frank Castle", "dob": "1980-12-01", "hospital": "St. Jude Medical", "plan": "Silver HMO", "status": "Active", "copay": "$35"},
    "107": {"name": "Grace Hopper", "dob": "1995-07-20", "hospital": "St. Jude Medical", "plan": "Gold PPO", "status": "Active", "copay": "$20"},
    "108": {"name": "Henry Ford", "dob": "1970-03-15", "hospital": "St. Jude Medical", "plan": "Bronze EPO", "status": "Inactive", "copay": "N/A"},
    "109": {"name": "Iris West", "dob": "1992-05-18", "hospital": "St. Jude Medical", "plan": "Platinum PPO", "status": "Active", "copay": "$15"},
    "110": {"name": "Jack Ryan", "dob": "1983-08-25", "hospital": "St. Jude Medical", "plan": "Silver HMO", "status": "Active", "copay": "$35"},
    
    # City Hope Clinic (111-115)
    "111": {"name": "Kevin Hart", "dob": "1989-01-10", "hospital": "City Hope Clinic", "plan": "Gold PPO", "status": "Active", "copay": "$25"},
    "112": {"name": "Laura Croft", "dob": "1993-04-22", "hospital": "City Hope Clinic", "plan": "Silver HMO", "status": "Active", "copay": "$30"},
    "113": {"name": "Mike Ross", "dob": "1987-11-11", "hospital": "City Hope Clinic", "plan": "Bronze EPO", "status": "Active", "copay": "$50"},
    "114": {"name": "Nancy Drew", "dob": "1998-02-28", "hospital": "City Hope Clinic", "plan": "Platinum PPO", "status": "Active", "copay": "$10"},
    "115": {"name": "Oscar Isaac", "dob": "1982-06-05", "hospital": "City Hope Clinic", "plan": "Gold PPO", "status": "Inactive", "copay": "N/A"},
}

@app.post("/get_eligibility", response_model=EligibilityResponse)
async def get_eligibility(request: EligibilityRequest, x_hospital_id: str | None = Header(None)):
    """Mock endpoint for checking patient eligibility with Hospital Scoping"""
    # Simulate processing delay
    import asyncio
    await asyncio.sleep(0.5)
    
    patient = MOCK_PATIENTS.get(request.patient_id)
    
    # 1. Check if patient exists
    if not patient:
         if x_hospital_id:
             raise HTTPException(404, "Patient not found in your hospital records.")
         
         # Fallback for unknown IDs if no hospital scope (legacy behavior)
         patient = {
             "name": f"Patient {request.patient_id}", 
             "dob": "1980-01-01", 
             "hospital": "Unknown", 
             "plan": "Basic", 
             "status": "Inactive",
             "copay": "$0"
         }

    # 2. Check Hospital Access
    if x_hospital_id and patient.get("hospital") != x_hospital_id:
         # SIMULATE ACCESS DENIED
         raise HTTPException(403, f"Access Denied: Patient belongs to {patient.get('hospital')}")

    return EligibilityResponse(
        status=patient["status"],
        plan_name=patient["plan"],
        coverage_details={
            "copay": patient["copay"],
            "deductible_remaining": "$500.00" if patient["status"] == "Active" else "$0.00",
            "coinsurance": "20%",
            "out_of_pocket_max": "$5000.00",
            "hospital": patient["hospital"],
            "service_date": request.service_date,
        },
        patient={
            "id": request.patient_id,
            "name": patient["name"],
            "dob": patient["dob"],
        },
        timestamp=datetime.utcnow()
    )


@app.post("/get_eligibility_chat")
async def get_eligibility_chat(request: dict, x_hospital_id: str | None = Header(None)):
    """AI-powered eligibility chat assistant using Bedrock with Mock Data context"""
    user_message = request.get("message", "").lower()
    
    # Try to extract patient ID (any 1-5 digit number)
    import re
    id_match = re.search(r'\b(\d{1,5})\b', user_message)
    found_id = id_match.group(1) if id_match else None
    
    # Lookup context
    context_str = "No specific patient found in local records."
    suggested_actions = ["Check Patient 101", "Check Patient 106"]
    
    if found_id and found_id in MOCK_PATIENTS:
        p = MOCK_PATIENTS[found_id]
        
        # Enforce Hospital Isolation in Context
        if x_hospital_id and p["hospital"] != x_hospital_id:
             return {
                 "response": f"I cannot access records for Patient ID {found_id}. They belong to **{p['hospital']}**, not your facility.",
                 "suggested_actions": ["Check Local Directory"]
             }
        
        context_str = f"""
        Patient Found:
        Name: {p['name']}
        ID: {found_id}
        Hospital: {p['hospital']}
        Status: {p['status']}
        Plan: {p['plan']}
        Copay: {p['copay']}
        """
        suggested_actions = ["Check Deductible", "Download Summary"]

    # Try Bedrock
    # Select Model
    model_choice = request.get("model", "claude")
    
    try:
        settings = get_settings()
        bedrock = boto3.client("bedrock-runtime", region_name=settings.aws_region)
        
        prompt = f"""
        You are a helpful healthcare eligibility assistant for {x_hospital_id or 'this hospital'}.
        User has asked: "{user_message}"
        
        Context from records:
        {context_str}
        
        Instructions:
        1. Answer the user's question based on the "Context from records" provided above.
        2. If the user provides patient details (like name, plan, or status) directly in their message, you should use that information to help them if a record isn't found in our system.
        3. Summarize benefits clearly using markdown for **bolding** key details.
        4. If no patient information is available at all, politely ask for a Patient ID.
        
        Assistant:
        """
        
        if model_choice == "titan":
            model_id = "amazon.titan-text-express-v1"
            body = json.dumps({
                "inputText": prompt,
                "textGenerationConfig": {
                    "maxTokenCount": 512,
                    "temperature": 0.5,
                    "topP": 0.9
                }
            })
            response = bedrock.invoke_model(modelId=model_id, body=body)
            response_body = json.loads(response.get("body").read())
            ai_reply = response_body["results"][0]["outputText"]
             
        else:
            # Default: Claude 3 Haiku
            model_id = "anthropic.claude-3-haiku-20240307-v1:0"
            body = json.dumps({
               "anthropic_version": "bedrock-2023-05-31",
               "max_tokens": 512,
               "messages": [
                   {"role": "user", "content": prompt}
               ]
            })
            response = bedrock.invoke_model(modelId=model_id, body=body)
            response_body = json.loads(response.get("body").read())
            ai_reply = response_body["content"][0]["text"]
        
        return {
            "response": ai_reply,
            "suggested_actions": suggested_actions
        }

    except Exception as e:
        import traceback
        print(f"Bedrock invocation failed for model {model_choice}: {e}")
        traceback.print_exc()
        # Fallback to Mock Logic if Bedrock fails (e.g. model not enabled)
        if found_id and found_id in MOCK_PATIENTS:
             p = MOCK_PATIENTS[found_id]
             return {
                "response": f"Found **{p['name']}** (ID: {found_id}) at **{p['hospital']}**.\n\n**Status**: {p['status']}\n**Plan**: {p['plan']}\n**Copay**: {p['copay']} (AI Offline)",
                "suggested_actions": suggested_actions
            }
        
        return {
             "response": "I'm your eligibility assistant. Please provide a **Patient ID** to check benefits. (AI Service Unavailable)",
             "suggested_actions": ["Check Patient 101"]
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
