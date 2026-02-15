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
        """Convert to DynamoDB item format (Single Table Design)"""
        item = {
            "PK": {"S": f"TENANT#{self.user_id}#JOB#{self.job_id}"},
            "SK": {"S": "META"},
            "user_id": {"S": self.user_id},
            "job_id": {"S": self.job_id},
            "url": {"S": self.url},
            "priority": {"S": self.priority.value},
            "status": {"S": self.status.value},
            "timeout_seconds": {"N": str(self.timeout_seconds)},
            "metadata": {"S": str(self.metadata)},
            "created_at": {"N": str(self.created_at.timestamp())},
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
        
        # Extract job_id from PK if job_id field is missing
        job_id = item.get("job_id", {}).get("S")
        if not job_id:
            pk = item["PK"]["S"]
            job_id = pk.split("#")[-1] if "#" in pk else pk

        return cls(
            job_id=job_id,
            user_id=item["user_id"]["S"],
            url=item["url"]["S"],
            priority=Priority(item["priority"]["S"]),
            status=JobStatus(item["status"]["S"]),
            timeout_seconds=int(item["timeout_seconds"]["N"]),
            metadata=eval(item.get("metadata", {}).get("S", "{}")),
            created_at=datetime.fromtimestamp(float(item["created_at"]["N"])),
            started_at=datetime.fromisoformat(item["started_at"]["S"]) if "started_at" in item else None,
            completed_at=datetime.fromisoformat(item["completed_at"]["S"]) if "completed_at" in item else None,
            result=result,
            task_arn=item.get("task_arn", {}).get("S"),
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


class EligibilityRequest(BaseModel):
    """Request for eligibility check"""
    patient_id: str = Field(..., description="Patient ID")
    provider_id: str = Field(..., description="Provider NPI")
    service_date: str = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"), description="Date of service")


class EligibilityResponse(BaseModel):
    """Mock eligibility response"""
    status: str
    plan_name: str
    coverage_details: dict[str, Any]
    patient: dict[str, str]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
