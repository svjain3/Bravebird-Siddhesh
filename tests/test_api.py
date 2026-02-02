"""Tests for API endpoints"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from src.api.main import app, _queue_urls
from src.api.models import JobStatus, Priority


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_aws():
    """Mock AWS clients"""
    with patch("src.api.main.get_sqs_client") as mock_sqs, \
         patch("src.api.main.get_dynamodb_client") as mock_dynamodb, \
         patch("src.api.main.get_s3_client") as mock_s3:
        
        # Mock SQS
        sqs = MagicMock()
        sqs.get_queue_url.return_value = {"QueueUrl": "http://localhost:4566/queue"}
        mock_sqs.return_value = sqs
        
        # Pre-populate queue URLs cache (normally done at startup)
        _queue_urls[Priority.HIGH.value] = "http://localhost:4566/jobs-high.fifo"
        _queue_urls[Priority.NORMAL.value] = "http://localhost:4566/jobs-normal.fifo"
        _queue_urls[Priority.LOW.value] = "http://localhost:4566/jobs-low.fifo"
        
        # Mock DynamoDB
        dynamodb = MagicMock()
        dynamodb.update_item.return_value = {"Attributes": {"count": {"N": "1"}}}
        dynamodb.put_item.return_value = {}
        mock_dynamodb.return_value = dynamodb
        
        # Mock S3
        s3 = MagicMock()
        mock_s3.return_value = s3
        
        yield {
            "sqs": sqs,
            "dynamodb": dynamodb,
            "s3": s3,
        }
        
        # Clean up queue URLs cache
        _queue_urls.clear()


class TestHealthEndpoint:
    def test_health_check(self, client, mock_aws):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestJobSubmission:
    def test_submit_job_success(self, client, mock_aws):
        response = client.post("/jobs", json={
            "url": "https://example.com",
            "user_id": "test-user",
            "priority": "normal",
        })
        
        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data
        assert data["status"] == JobStatus.QUEUED.value
    
    def test_submit_job_validation_error(self, client, mock_aws):
        response = client.post("/jobs", json={
            "url": "https://example.com",
            # Missing user_id
        })
        
        assert response.status_code == 422
    
    def test_submit_job_rate_limited(self, client, mock_aws):
        # Simulate rate limit exceeded by raising ClientError
        from botocore.exceptions import ClientError
        mock_aws["dynamodb"].update_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException", "Message": "Rate limit"}},
            "UpdateItem"
        )
        
        response = client.post("/jobs", json={
            "url": "https://example.com",
            "user_id": "rate-limited-user",
        })
        
        # Rate limit exceeded returns 429 Too Many Requests
        assert response.status_code == 429
        assert "Rate limit exceeded" in response.json()["detail"]



class TestJobStatus:
    def test_get_job_not_found(self, client, mock_aws):
        mock_aws["dynamodb"].get_item.return_value = {}
        
        response = client.get("/jobs/job-nonexistent")
        assert response.status_code == 404
    
    def test_get_job_success(self, client, mock_aws):
        mock_aws["dynamodb"].get_item.return_value = {
            "Item": {
                "pk": {"S": "job-123"},
                "user_id": {"S": "test-user"},
                "url": {"S": "https://example.com"},
                "priority": {"S": "normal"},
                "status": {"S": "completed"},
                "timeout_seconds": {"N": "600"},
                "created_at": {"S": "2024-01-01T00:00:00"},
            }
        }
        
        response = client.get("/jobs/job-123")
        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == "job-123"
        assert data["status"] == "completed"


class TestJobCancellation:
    def test_cancel_job_success(self, client, mock_aws):
        mock_aws["dynamodb"].get_item.return_value = {
            "Item": {
                "pk": {"S": "job-123"},
                "user_id": {"S": "test-user"},
                "url": {"S": "https://example.com"},
                "priority": {"S": "normal"},
                "status": {"S": "running"},
                "timeout_seconds": {"N": "600"},
                "created_at": {"S": "2024-01-01T00:00:00"},
            }
        }
        
        response = client.delete("/jobs/job-123")
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"
    
    def test_cancel_completed_job(self, client, mock_aws):
        mock_aws["dynamodb"].get_item.return_value = {
            "Item": {
                "pk": {"S": "job-123"},
                "user_id": {"S": "test-user"},
                "url": {"S": "https://example.com"},
                "priority": {"S": "normal"},
                "status": {"S": "completed"},
                "timeout_seconds": {"N": "600"},
                "created_at": {"S": "2024-01-01T00:00:00"},
            }
        }
        
        response = client.delete("/jobs/job-123")
        assert response.status_code == 400
