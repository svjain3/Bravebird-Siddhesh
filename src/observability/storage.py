"""S3 Storage utilities for screenshots and artifacts"""
import os
from datetime import datetime
from typing import Optional

import boto3
from botocore.exceptions import ClientError


class StorageManager:
    """Manage S3 storage for job artifacts"""
    
    def __init__(self, bucket_name: str = None, endpoint_url: str = None):
        self.bucket_name = bucket_name or os.environ.get("S3_BUCKET", "job-artifacts")
        self.endpoint_url = endpoint_url or os.environ.get("AWS_ENDPOINT_URL")
        self.client = boto3.client("s3", endpoint_url=self.endpoint_url)
    
    def upload_screenshot(self, job_id: str, file_path: str) -> str:
        """Upload screenshot and return S3 key"""
        key = f"jobs/{job_id}/screenshot.png"
        
        with open(file_path, "rb") as f:
            self.client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=f,
                ContentType="image/png",
            )
        
        return key
    
    def upload_logs(self, job_id: str, logs: str) -> str:
        """Upload job logs"""
        key = f"jobs/{job_id}/logs.txt"
        
        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=logs.encode("utf-8"),
            ContentType="text/plain",
        )
        
        return key
    
    def generate_presigned_url(self, key: str, expiry_seconds: int = 3600) -> str:
        """Generate pre-signed URL for downloading"""
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expiry_seconds,
        )
    
    def get_job_artifacts(self, job_id: str) -> dict:
        """Get all artifact URLs for a job"""
        prefix = f"jobs/{job_id}/"
        artifacts = {}
        
        try:
            response = self.client.list_objects_v2(
                Bucket=self.bucket_name,
                Prefix=prefix,
            )
            
            for obj in response.get("Contents", []):
                key = obj["Key"]
                filename = key.split("/")[-1]
                artifacts[filename] = self.generate_presigned_url(key)
                
        except ClientError:
            pass
        
        return artifacts
    
    def cleanup_old_artifacts(self, max_age_days: int = 7) -> int:
        """Delete artifacts older than max_age_days"""
        deleted = 0
        cutoff = datetime.utcnow().timestamp() - (max_age_days * 24 * 3600)
        
        try:
            paginator = self.client.get_paginator("list_objects_v2")
            
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix="jobs/"):
                for obj in page.get("Contents", []):
                    if obj["LastModified"].timestamp() < cutoff:
                        self.client.delete_object(
                            Bucket=self.bucket_name,
                            Key=obj["Key"],
                        )
                        deleted += 1
                        
        except ClientError as e:
            print(f"Cleanup error: {e}")
        
        return deleted


# Singleton
_storage: Optional[StorageManager] = None


def get_storage() -> StorageManager:
    """Get storage manager instance"""
    global _storage
    if _storage is None:
        _storage = StorageManager()
    return _storage
