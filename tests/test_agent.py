import os
import pytest
from unittest.mock import patch, MagicMock, AsyncMock, mock_open
from agent.agent import run_agent

@pytest.fixture
def mock_env():
    with patch.dict("os.environ", {
        "JOB_ID": "test-job-123",
        "TARGET_URL": "https://example.com",
        "TIMEOUT_SECONDS": "60",
        "S3_BUCKET": "test-bucket",
        "DYNAMODB_TABLE": "test-table",
        "OUTPUT_DIR": "/tmp",
    }):
        yield

@pytest.mark.asyncio
async def test_run_agent_success(mock_env):
    # Mock Playwright
    with patch("agent.agent.async_playwright") as mock_pw:
        # Mocking the context manager structure of Playwright
        mock_pw_context = AsyncMock()
        mock_pw.return_value.__aenter__.return_value = mock_pw_context
        
        mock_browser = AsyncMock()
        mock_pw_context.chromium.launch.return_value = mock_browser
        
        mock_context = AsyncMock()
        mock_browser.new_context.return_value = mock_context
        
        mock_page = AsyncMock()
        mock_context.new_page.return_value = mock_page
        mock_page.title.return_value = "Example Domain"
        
        # Mock S3 and DynamoDB
        with patch("agent.agent.get_s3_client") as mock_s3_factory, \
             patch("agent.agent.get_dynamodb_client") as mock_ddb_factory, \
             patch("builtins.open", mock_open(read_data=b"dummy screenshot data")):
            
            mock_s3 = MagicMock()
            mock_s3_factory.return_value = mock_s3
            
            mock_ddb = MagicMock()
            mock_ddb_factory.return_value = mock_ddb
            
            # Run the agent
            exit_code = await run_agent()
            
            # Assertions
            assert exit_code == 0
            
            # Verify browser interactions
            mock_pw_context.chromium.launch.assert_called_once()
            mock_page.goto.assert_called_once_with(
                "https://example.com",
                timeout=60000,
                wait_until="networkidle"
            )
            mock_page.screenshot.assert_called_once()
            mock_browser.close.assert_called_once()
            
            # Verify S3 upload
            mock_s3.put_object.assert_called_once()
            args, kwargs = mock_s3.put_object.call_args
            assert kwargs["Bucket"] == "test-bucket"
            assert kwargs["Key"] == "jobs/test-job-123/screenshot.png"
            
            # Verify DynamoDB update
            mock_ddb.update_item.assert_called_once()
            ddb_args, ddb_kwargs = mock_ddb.update_item.call_args
            assert ddb_kwargs["TableName"] == "test-table"
            assert ddb_kwargs["Key"] == {"pk": {"S": "test-job-123"}}
            assert "completed" in ddb_kwargs["ExpressionAttributeValues"][":status"]["S"]

@pytest.mark.asyncio
async def test_run_agent_failure(mock_env):
    # Mock Playwright to raise an exception
    with patch("agent.agent.async_playwright") as mock_pw:
        mock_pw.side_effect = Exception("Browser crash")
        
        with patch("agent.agent.get_dynamodb_client") as mock_ddb_factory:
            mock_ddb = MagicMock()
            mock_ddb_factory.return_value = mock_ddb
            
            # Run the agent
            exit_code = await run_agent()
            
            # Assertions
            assert exit_code == 1
            
            # Verify DynamoDB update for failure
            mock_ddb.update_item.assert_called_once()
            ddb_args, ddb_kwargs = mock_ddb.update_item.call_args
            assert ddb_kwargs["ExpressionAttributeValues"][":status"]["S"] == "failed"
            assert "Browser crash" in ddb_kwargs["ExpressionAttributeValues"][":result"]["S"]
