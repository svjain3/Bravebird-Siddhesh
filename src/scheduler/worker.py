"""
Local Worker - Polls SQS and runs agent containers locally

This simulates what Lambda + ECS does in production, but runs locally using Docker.
"""
import json
import os
import subprocess
import sys
import time
from datetime import datetime

import boto3


def get_sqs_client():
    """Get SQS client for LocalStack"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
    return boto3.client(
        "sqs",
        endpoint_url=endpoint_url,
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )


def get_dynamodb_client():
    """Get DynamoDB client for LocalStack"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")
    return boto3.client(
        "dynamodb",
        endpoint_url=endpoint_url,
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id="test",
        aws_secret_access_key="test",
    )


def update_job_status(job_id: str, status: str):
    """Update job status in DynamoDB"""
    dynamodb = get_dynamodb_client()
    table_name = os.environ.get("DYNAMODB_TABLE", "jobs")
    
    try:
        dynamodb.update_item(
            TableName=table_name,
            Key={"pk": {"S": job_id}},
            UpdateExpression="SET #status = :status, started_at = :now",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": {"S": status},
                ":now": {"S": datetime.utcnow().isoformat()},
            },
        )
    except Exception as e:
        print(f"[Worker] Warning: Failed to update status: {e}")


def run_agent_container(job: dict) -> int:
    """Run agent container locally using Docker"""
    job_id = job["job_id"]
    url = job.get("url", "https://example.com")
    timeout = job.get("timeout_seconds", 300)
    
    print(f"[Worker] Launching container for job {job_id}")
    print(f"[Worker] URL: {url}")
    
    # Run agent container
    cmd = [
        "docker", "run", "--rm",
        "-e", f"JOB_ID={job_id}",
        "-e", f"TARGET_URL={url}",
        "-e", f"TIMEOUT_SECONDS={timeout}",
        "-e", "S3_BUCKET=job-artifacts",
        "-e", "DYNAMODB_TABLE=jobs",
        "-e", "AWS_ENDPOINT_URL=http://host.docker.internal:4566",
        "-e", "AWS_ACCESS_KEY_ID=test",
        "-e", "AWS_SECRET_ACCESS_KEY=test",
        "-e", "AWS_REGION=us-east-1",
        "-v", "/tmp/agent-output:/output",
        "ephemeral-agent:latest",
    ]
    
    result = subprocess.run(cmd, capture_output=False)
    return result.returncode


def poll_queue(queue_url: str, queue_name: str) -> bool:
    """Poll a single queue for messages, return True if message was processed"""
    sqs = get_sqs_client()
    
    try:
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=1,  # Short poll for responsiveness
        )
    except Exception as e:
        print(f"[Worker] Error polling {queue_name}: {e}")
        return False
    
    messages = response.get("Messages", [])
    if not messages:
        return False
    
    msg = messages[0]
    receipt_handle = msg["ReceiptHandle"]
    
    try:
        job = json.loads(msg["Body"])
        job_id = job["job_id"]
        
        print(f"\n{'='*60}")
        print(f"[Worker] Received job from {queue_name}: {job_id}")
        print(f"{'='*60}")
        
        # Update status to running
        update_job_status(job_id, "running")
        
        # Run the agent container (ephemeral!)
        exit_code = run_agent_container(job)
        
        if exit_code == 0:
            print(f"[Worker] Job {job_id} completed successfully")
        else:
            print(f"[Worker] Job {job_id} failed with exit code {exit_code}")
        
        # Delete message from queue (job processed)
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
        print(f"[Worker] Container destroyed, message deleted from queue")
        print(f"{'='*60}\n")
        
        return True
        
    except Exception as e:
        print(f"[Worker] Error processing job: {e}")
        # Don't delete message - will retry or go to DLQ
        return False


def main():
    """Main worker loop - polls SQS queues in priority order"""
    print("="*60)
    print("  EPHEMERAL WORKER - Local Job Processor")
    print("="*60)
    print("Polling SQS queues for jobs...")
    print("Press Ctrl+C to stop\n")
    
    sqs = get_sqs_client()
    
    # Get queue URLs
    queues = [
        ("jobs-high.fifo", "HIGH"),
        ("jobs-normal.fifo", "NORMAL"),
        ("jobs-low.fifo", "LOW"),
    ]
    
    queue_urls = {}
    for queue_name, priority in queues:
        try:
            response = sqs.get_queue_url(QueueName=queue_name)
            queue_urls[priority] = response["QueueUrl"]
            print(f"[Worker] Found queue: {queue_name}")
        except Exception as e:
            print(f"[Worker] Warning: Queue {queue_name} not found: {e}")
    
    if not queue_urls:
        print("[Worker] ERROR: No queues found. Is LocalStack running?")
        sys.exit(1)
    
    print(f"\n[Worker] Monitoring {len(queue_urls)} queues...\n")
    
    # Poll loop
    try:
        while True:
            # Poll in priority order: HIGH > NORMAL > LOW
            for priority in ["HIGH", "NORMAL", "LOW"]:
                if priority in queue_urls:
                    if poll_queue(queue_urls[priority], priority):
                        break  # Process one job at a time, restart priority scan
            else:
                # No messages found, wait a bit
                time.sleep(2)
                
    except KeyboardInterrupt:
        print("\n[Worker] Shutting down...")


if __name__ == "__main__":
    main()
