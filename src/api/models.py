"""Pydantic models for Jobs and API requests/responses"""
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field
from ulid import ULID


class Priority(str, Enum):
    """Job priority levels"""
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class JobStatus(str, Enum):
    """Job lifecycle states"""
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class JobInput(BaseModel):
    """Request body for creating a new job"""
    url: str = Field(..., description="Target URL for the agent to visit")
    user_id: str = Field(..., description="User identifier for rate limiting")
    priority: Priority = Field(default=Priority.NORMAL, description="Job priority")
    timeout_seconds: int = Field(default=600, ge=60, le=3600, description="Max execution time")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Custom metadata")


class JobResult(BaseModel):
    """Result of a completed job"""
    screenshot_url: str | None = None
    logs_url: str | None = None
    exit_code: int | None = None
    error_message: str | None = None
    duration_seconds: float | None = None


class Job(BaseModel):
    """Full job representation"""
    job_id: str = Field(default_factory=lambda: f"job-{ULID()}")
    user_id: str
    url: str
    priority: Priority
    status: JobStatus = JobStatus.PENDING
    timeout_seconds: int = 600
    metadata: dict[str, Any] = Field(default_factory=dict)
    result: JobResult | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    task_arn: str | None = None  # ECS task ARN
    
    def to_dynamodb_item(self) -> dict:
        """Convert to DynamoDB item format"""
        item = {
            "pk": {"S": self.job_id},
            "user_id": {"S": self.user_id},
            "url": {"S": self.url},
            "priority": {"S": self.priority.value},
            "status": {"S": self.status.value},
            "timeout_seconds": {"N": str(self.timeout_seconds)},
            "metadata": {"S": str(self.metadata)},
            "created_at": {"S": self.created_at.isoformat()},
        }
        if self.started_at:
            item["started_at"] = {"S": self.started_at.isoformat()}
        if self.completed_at:
            item["completed_at"] = {"S": self.completed_at.isoformat()}
        if self.task_arn:
            item["task_arn"] = {"S": self.task_arn}
        if self.result:
            item["result"] = {"S": self.result.model_dump_json()}
        return item
    
    @classmethod
    def from_dynamodb_item(cls, item: dict) -> "Job":
        """Create from DynamoDB item format"""
        result = None
        if "result" in item:
            import json
            result = JobResult.model_validate_json(item["result"]["S"])
        
        return cls(
            job_id=item["pk"]["S"],
            user_id=item["user_id"]["S"],
            url=item["url"]["S"],
            priority=Priority(item["priority"]["S"]),
            status=JobStatus(item["status"]["S"]),
            timeout_seconds=int(item["timeout_seconds"]["N"]),
            metadata=eval(item.get("metadata", {}).get("S", "{}")),
            created_at=datetime.fromisoformat(item["created_at"]["S"]),
            started_at=datetime.fromisoformat(item["started_at"]["S"]) if "started_at" in item else None,
            completed_at=datetime.fromisoformat(item["completed_at"]["S"]) if "completed_at" in item else None,
            task_arn=item.get("task_arn", {}).get("S"),
            result=result,
        )


class JobSubmitResponse(BaseModel):
    """Response after submitting a job"""
    job_id: str
    status: JobStatus
    queue_position: int | None = None


class JobStatusResponse(BaseModel):
    """Response for job status query"""
    job_id: str
    status: JobStatus
    url: str
    priority: Priority
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: JobResult | None = None


class HealthResponse(BaseModel):
    """Health check response"""
    status: str = "ok"
    version: str = "0.1.0"
    services: dict[str, str] = Field(default_factory=dict)
