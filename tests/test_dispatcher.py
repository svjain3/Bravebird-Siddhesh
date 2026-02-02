import json
import os
import pytest
from unittest.mock import patch, MagicMock
from src.scheduler.dispatcher import handler

@pytest.fixture
def mock_env():
    with patch.dict("os.environ", {
        "ECS_CLUSTER": "test-cluster",
        "ECS_TASK_DEFINITION": "test-task-def",
        "ECS_SUBNETS": "subnet-1,subnet-2",
        "ECS_SECURITY_GROUPS": "sg-1",
        "DYNAMODB_TABLE": "test-jobs",
        "AGENT_SECRET_ARN": "arn:aws:secrets:test",
    }):
        yield

def test_dispatcher_handler_success(mock_env):
    event = {
        "Records": [
            {
                "body": json.dumps({
                    "job_id": "job-123",
                    "url": "https://example.com",
                    "timeout_seconds": 300,
                })
            }
        ]
    }
    
    with patch("src.scheduler.dispatcher.get_ecs_client") as mock_ecs_factory, \
         patch("src.scheduler.dispatcher.get_dynamodb_client") as mock_ddb_factory:
        
        mock_ecs = MagicMock()
        mock_ecs.run_task.return_value = {
            "tasks": [{"taskArn": "arn:aws:ecs:task-123"}],
            "failures": []
        }
        mock_ecs_factory.return_value = mock_ecs
        
        mock_ddb = MagicMock()
        mock_ddb_factory.return_value = mock_ddb
        
        # Run the handler
        response = handler(event, None)
        
        # Assertions
        assert response["statusCode"] == 200
        body = json.loads(response["body"])
        assert body["processed"] == 1
        assert body["failed"] == 0
        
        # Verify ECS RunTask call
        mock_ecs.run_task.assert_called_once()
        _, kwargs = mock_ecs.run_task.call_args
        assert kwargs["cluster"] == "test-cluster"
        assert kwargs["taskDefinition"] == "test-task-def"
        assert "capacityProviderStrategy" in kwargs
        assert kwargs["networkConfiguration"]["awsvpcConfiguration"]["subnets"] == ["subnet-1", "subnet-2"]
        
        # Verify DynamoDB calls (one for 'running', one for adding task_arn)
        assert mock_ddb.update_item.call_count == 2
        ddb_call_1 = mock_ddb.update_item.call_args_list[0]
        assert ddb_call_1.kwargs["ExpressionAttributeValues"][":status"]["S"] == "running"
        
        ddb_call_2 = mock_ddb.update_item.call_args_list[1]
        assert ddb_call_2.kwargs["ExpressionAttributeValues"][":task_arn"]["S"] == "arn:aws:ecs:task-123"

def test_dispatcher_handler_failure(mock_env):
    event = {
        "Records": [
            {
                "body": json.dumps({
                    "job_id": "job-123",
                    "url": "https://example.com",
                })
            }
        ]
    }
    
    with patch("src.scheduler.dispatcher.get_ecs_client") as mock_ecs_factory, \
         patch("src.scheduler.dispatcher.get_dynamodb_client") as mock_ddb_factory:
        
        mock_ecs = MagicMock()
        # Simulate ECS failure
        mock_ecs.run_task.return_value = {
            "tasks": [],
            "failures": [{"reason": "Capacity unavailable"}]
        }
        mock_ecs_factory.return_value = mock_ecs
        
        mock_ddb = MagicMock()
        mock_ddb_factory.return_value = mock_ddb
        
        # Run the handler - it should raise an exception to trigger SQS retry
        with pytest.raises(Exception, match="Failed to start task"):
            handler(event, None)
        
        # Verify DynamoDB called for 'running' but not for second update
        assert mock_ddb.update_item.call_count == 1
