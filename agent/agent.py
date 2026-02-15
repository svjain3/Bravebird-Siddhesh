"""
Ephemeral Agent - Computer Use Task Executor

This agent runs inside a Fargate container and performs browser automation:
1. Opens browser (Playwright)
2. Navigates to target URL
3. Takes screenshot
4. Uploads to S3
5. Updates job status in DynamoDB
6. Exits with status code
"""
import asyncio
import json
import os
import sys
from datetime import datetime

import boto3
from playwright.async_api import async_playwright


def get_s3_client():
    """Get S3 client with optional LocalStack endpoint"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL")
    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client("s3", endpoint_url=endpoint_url, region_name=region)


def get_dynamodb_client():
    """Get DynamoDB client with optional LocalStack endpoint"""
    endpoint_url = os.environ.get("AWS_ENDPOINT_URL")
    region = os.environ.get("AWS_REGION", "us-east-1")
    return boto3.client("dynamodb", endpoint_url=endpoint_url, region_name=region)


def update_job_status(job_id: str, status: str, result: dict = None):
    """
    Update job status in DynamoDB.
    
    Called when agent completes (success or failure) to update the job record.
    """
    dynamodb = get_dynamodb_client()
    table_name = os.environ.get("DYNAMODB_TABLE", "bravebird-jobs")
    
    update_expr = "SET #status = :status, completed_at = :now"
    expr_names = {"#status": "status"}
    expr_values = {
        ":status": {"S": status},
        ":now": {"S": datetime.utcnow().isoformat()},
    }
    
    if result:
        update_expr += ", #result = :result"
        expr_names["#result"] = "result"
        expr_values[":result"] = {"S": json.dumps(result)}
    
    try:
        dynamodb.update_item(
            TableName=table_name,
            Key={"PK": {"S": job_id}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
        print(f"[{job_id}] Updated status to '{status}' in DynamoDB")
    except Exception as e:
        print(f"[{job_id}] Warning: Failed to update DynamoDB: {e}")


async def run_agent():
    """Main agent execution"""
    job_id = os.environ.get("JOB_ID", "unknown")
    target_url = os.environ.get("TARGET_URL") or os.environ.get("PORTAL_URL") or "https://example.com"
    timeout_seconds = int(os.environ.get("TIMEOUT_SECONDS", "300"))
    s3_bucket = os.environ.get("S3_BUCKET", "bravebird-artifacts")
    output_dir = os.environ.get("OUTPUT_DIR", "/output")
    
    print(f"[{job_id}] Starting agent")
    print(f"[{job_id}] Target URL: {target_url}")
    print(f"[{job_id}] Timeout: {timeout_seconds}s")
    
    start_time = datetime.utcnow()
    screenshot_path = os.path.join(output_dir, "screenshot.png")
    
    try:
        async with async_playwright() as p:
            # Launch browser
            print(f"[{job_id}] Launching browser...")
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                ]
            )
            
            # Create context and page
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            )
            page = await context.new_page()
            
            # Navigate to URL with timeout
            print(f"[{job_id}] Navigating to {target_url}...")
            try:
                await page.goto(
                    target_url,
                    timeout=min(timeout_seconds * 1000, 60000),  # Max 60s for navigation
                    wait_until="networkidle",
                )
            except Exception as nav_error:
                print(f"[{job_id}] Navigation warning: {nav_error}")
                # Continue anyway - page might still be usable
            
            # Wait a moment for any dynamic content
            await asyncio.sleep(2)
            
            # Take screenshot
            print(f"[{job_id}] Taking screenshot...")
            await page.screenshot(path=screenshot_path, full_page=True)
            
            # Get page title for logging
            title = await page.title()
            print(f"[{job_id}] Page title: {title}")
            
            # Close browser
            await browser.close()
        
        # Upload screenshot to S3
        print(f"[{job_id}] Uploading screenshot to S3...")
        s3 = get_s3_client()
        s3_key = f"jobs/{job_id}/screenshot.png"
        
        try:
            with open(screenshot_path, "rb") as f:
                s3.put_object(
                    Bucket=s3_bucket,
                    Key=s3_key,
                    Body=f,
                    ContentType="image/png",
                )
            print(f"[{job_id}] Screenshot uploaded to s3://{s3_bucket}/{s3_key}")
        except Exception as s3_error:
            print(f"[{job_id}] S3 upload error: {s3_error}")
            # Don't fail the job - screenshot is still on disk
        
        # Success
        duration = (datetime.utcnow() - start_time).total_seconds()
        print(f"[{job_id}] Agent completed successfully in {duration:.1f}s")
        
        # Update job status in DynamoDB
        update_job_status(job_id, "completed", {
            "screenshot_url": f"s3://{s3_bucket}/{s3_key}",
            "exit_code": 0,
            "duration_seconds": duration,
        })
        
        return 0
        
    except Exception as e:
        duration = (datetime.utcnow() - start_time).total_seconds()
        print(f"[{job_id}] Agent failed: {e}")
        
        # Update job status in DynamoDB
        update_job_status(job_id, "failed", {
            "exit_code": 1,
            "error_message": str(e),
            "duration_seconds": duration,
        })
        
        return 1


def main():
    """Entry point"""
    try:
        exit_code = asyncio.run(run_agent())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("Agent interrupted")
        sys.exit(130)
    except Exception as e:
        print(f"Agent crashed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
