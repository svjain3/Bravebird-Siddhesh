"""ECS Task Executor - For local Docker-based execution"""
import asyncio
import json
import os
from datetime import datetime
from typing import Optional

import docker
from docker.errors import APIError, NotFound


class DockerExecutor:
    """Execute agent tasks in Docker containers (local development)"""
    
    def __init__(self):
        self.client = docker.from_env()
        self.network_name = "ephemeral-agent-network"
        self._ensure_network()
    
    def _ensure_network(self):
        """Create isolated network if it doesn't exist"""
        try:
            self.client.networks.get(self.network_name)
        except NotFound:
            self.client.networks.create(
                self.network_name,
                driver="bridge",
                internal=False,  # Allow egress
                labels={"app": "ephemeral-agent"},
            )
    
    async def run_task(
        self,
        job_id: str,
        url: str,
        timeout_seconds: int = 600,
        secrets: dict[str, str] = None,
    ) -> dict:
        """
        Run agent container and return results.
        
        Simulates Fargate task execution locally using Docker.
        """
        container = None
        
        try:
            # Prepare environment (no secrets in env directly)
            environment = {
                "JOB_ID": job_id,
                "TARGET_URL": url,
                "TIMEOUT_SECONDS": str(timeout_seconds),
                "S3_BUCKET": os.environ.get("S3_BUCKET", "job-artifacts"),
                "AWS_ENDPOINT_URL": os.environ.get("AWS_ENDPOINT_URL", ""),
            }
            
            # Prepare volumes for output
            output_dir = f"/tmp/jobs/{job_id}"
            os.makedirs(output_dir, exist_ok=True)
            
            # Run container
            container = self.client.containers.run(
                image="ephemeral-agent:latest",
                name=f"agent-{job_id}",
                environment=environment,
                volumes={
                    output_dir: {"bind": "/output", "mode": "rw"},
                },
                network=self.network_name,
                detach=True,
                labels={
                    "job_id": job_id,
                    "app": "ephemeral-agent",
                    "created_at": datetime.utcnow().isoformat(),
                },
                # Security: read-only root filesystem
                read_only=False,  # Agent needs to write screenshots
                # Resource limits
                mem_limit="512m",
                cpu_period=100000,
                cpu_quota=50000,  # 0.5 CPU
            )
            
            # Wait for container to complete with timeout
            start_time = datetime.utcnow()
            exit_code = None
            
            while True:
                container.reload()
                
                if container.status == "exited":
                    exit_code = container.attrs["State"]["ExitCode"]
                    break
                
                elapsed = (datetime.utcnow() - start_time).total_seconds()
                if elapsed > timeout_seconds:
                    # Kill container
                    container.kill()
                    return {
                        "status": "timeout",
                        "exit_code": -1,
                        "error": f"Task exceeded timeout of {timeout_seconds}s",
                        "logs": container.logs().decode("utf-8")[-5000:],  # Last 5KB
                    }
                
                await asyncio.sleep(1)
            
            # Get logs
            logs = container.logs().decode("utf-8")
            
            # Check for screenshot
            screenshot_path = os.path.join(output_dir, "screenshot.png")
            screenshot_exists = os.path.exists(screenshot_path)
            
            return {
                "status": "completed" if exit_code == 0 else "failed",
                "exit_code": exit_code,
                "logs": logs[-10000:],  # Last 10KB
                "screenshot_path": screenshot_path if screenshot_exists else None,
                "duration_seconds": (datetime.utcnow() - start_time).total_seconds(),
            }
            
        except APIError as e:
            return {
                "status": "failed",
                "exit_code": -1,
                "error": f"Docker API error: {e}",
            }
        finally:
            # Cleanup container
            if container:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
    
    def list_running_tasks(self) -> list[dict]:
        """List all running agent containers"""
        containers = self.client.containers.list(
            filters={"label": "app=ephemeral-agent"},
        )
        
        return [
            {
                "container_id": c.id[:12],
                "job_id": c.labels.get("job_id"),
                "status": c.status,
                "created_at": c.labels.get("created_at"),
            }
            for c in containers
        ]
    
    def kill_task(self, job_id: str) -> bool:
        """Kill a running task by job_id"""
        containers = self.client.containers.list(
            filters={"label": f"job_id={job_id}"},
        )
        
        for container in containers:
            container.kill()
            container.remove(force=True)
            return True
        
        return False
    
    def cleanup_old_tasks(self, max_age_seconds: int = 600) -> int:
        """Kill tasks older than max_age_seconds (reaper logic)"""
        killed = 0
        containers = self.client.containers.list(
            filters={"label": "app=ephemeral-agent"},
        )
        
        now = datetime.utcnow()
        
        for container in containers:
            created_at_str = container.labels.get("created_at")
            if created_at_str:
                created_at = datetime.fromisoformat(created_at_str)
                age = (now - created_at).total_seconds()
                
                if age > max_age_seconds:
                    print(f"Killing old task: {container.labels.get('job_id')}, age: {age:.0f}s")
                    container.kill()
                    container.remove(force=True)
                    killed += 1
        
        return killed


# Singleton instance
_executor: Optional[DockerExecutor] = None


def get_executor() -> DockerExecutor:
    """Get Docker executor instance"""
    global _executor
    if _executor is None:
        _executor = DockerExecutor()
    return _executor
