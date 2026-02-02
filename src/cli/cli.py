"""CLI tool for interacting with the Ephemeral Environment system"""
import json
import sys
from typing import Optional

import httpx
import typer
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel

app = typer.Typer(
    name="ephemeral",
    help="CLI for Ephemeral Environment Orchestration System",
)
console = Console()

API_BASE_URL = "http://localhost:8000"


def get_api_url() -> str:
    """Get API base URL from environment or default"""
    import os
    return os.environ.get("EPHEMERAL_API_URL", API_BASE_URL)


@app.command()
def submit(
    url: str = typer.Option(..., "--url", "-u", help="Target URL for the agent"),
    user_id: str = typer.Option("cli-user", "--user-id", "-U", help="User identifier"),
    priority: str = typer.Option("normal", "--priority", "-p", help="Job priority: high/normal/low"),
    timeout: int = typer.Option(600, "--timeout", "-t", help="Timeout in seconds"),
):
    """Submit a new job for execution"""
    api_url = get_api_url()
    
    with console.status("Submitting job..."):
        try:
            response = httpx.post(
                f"{api_url}/jobs",
                json={
                    "url": url,
                    "user_id": user_id,
                    "priority": priority,
                    "timeout_seconds": timeout,
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()
            
            console.print(Panel(
                f"[green]Job submitted successfully![/green]\n\n"
                f"Job ID: [bold]{data['job_id']}[/bold]\n"
                f"Status: {data['status']}",
                title="Job Submitted",
            ))
            
            console.print(f"\nTrack with: [bold]ephemeral status {data['job_id']}[/bold]")
            console.print(f"Stream logs: [bold]ephemeral logs {data['job_id']}[/bold]")
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                console.print("[red]Rate limit exceeded. Please wait and try again.[/red]")
            else:
                console.print(f"[red]Error: {e.response.text}[/red]")
            sys.exit(1)
        except httpx.ConnectError:
            console.print(f"[red]Cannot connect to API at {api_url}[/red]")
            console.print("Make sure the server is running: [bold]make local[/bold]")
            sys.exit(1)


@app.command()
def status(job_id: str = typer.Argument(..., help="Job ID to check")):
    """Get status of a job"""
    api_url = get_api_url()
    
    try:
        response = httpx.get(f"{api_url}/jobs/{job_id}", timeout=30)
        response.raise_for_status()
        data = response.json()
        
        # Create status table
        table = Table(title=f"Job: {job_id}")
        table.add_column("Field", style="cyan")
        table.add_column("Value", style="white")
        
        status_color = {
            "pending": "yellow",
            "queued": "yellow",
            "running": "blue",
            "completed": "green",
            "failed": "red",
            "timeout": "red",
            "cancelled": "gray",
        }.get(data["status"], "white")
        
        table.add_row("Status", f"[{status_color}]{data['status']}[/{status_color}]")
        table.add_row("URL", data["url"])
        table.add_row("Priority", data["priority"])
        table.add_row("Created", data["created_at"])
        
        if data.get("started_at"):
            table.add_row("Started", data["started_at"])
        if data.get("completed_at"):
            table.add_row("Completed", data["completed_at"])
        
        console.print(table)
        
        # Show result if available
        if data.get("result"):
            result = data["result"]
            console.print("\n[bold]Results:[/bold]")
            
            if result.get("screenshot_url"):
                console.print(f"  Screenshot: {result['screenshot_url']}")
            if result.get("exit_code") is not None:
                console.print(f"  Exit Code: {result['exit_code']}")
            if result.get("duration_seconds"):
                console.print(f"  Duration: {result['duration_seconds']:.1f}s")
            if result.get("error_message"):
                console.print(f"  [red]Error: {result['error_message']}[/red]")
                
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            console.print(f"[red]Job {job_id} not found[/red]")
        else:
            console.print(f"[red]Error: {e.response.text}[/red]")
        sys.exit(1)
    except httpx.ConnectError:
        console.print(f"[red]Cannot connect to API at {api_url}[/red]")
        sys.exit(1)


@app.command()
def logs(
    job_id: str = typer.Argument(..., help="Job ID to stream logs for"),
    follow: bool = typer.Option(True, "--follow", "-f", help="Follow logs in real-time"),
):
    """Stream logs from a job"""
    import asyncio
    import websockets
    
    api_url = get_api_url().replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{api_url}/jobs/{job_id}/logs"
    
    async def stream():
        console.print(f"[dim]Connecting to {ws_url}...[/dim]")
        try:
            async with websockets.connect(ws_url) as websocket:
                console.print(f"[green]Connected. Streaming logs for {job_id}...[/green]\n")
                
                async for message in websocket:
                    data = json.loads(message)
                    
                    if data.get("status") == "complete":
                        console.print(f"\n[green]Job {data.get('job_status', 'completed')}[/green]")
                        break
                    elif data.get("status") == "waiting":
                        console.print(f"[dim]{data.get('message', 'Waiting...')}[/dim]")
                    elif data.get("message"):
                        # Print log line
                        console.print(data["message"], end="")
                        
        except websockets.exceptions.ConnectionClosed:
            console.print("\n[yellow]Connection closed[/yellow]")
        except Exception as e:
            console.print(f"\n[red]Error: {e}[/red]")
    
    try:
        asyncio.run(stream())
    except KeyboardInterrupt:
        console.print("\n[dim]Stopped streaming[/dim]")


@app.command()
def cancel(job_id: str = typer.Argument(..., help="Job ID to cancel")):
    """Cancel a running or pending job"""
    api_url = get_api_url()
    
    with console.status("Cancelling job..."):
        try:
            response = httpx.delete(f"{api_url}/jobs/{job_id}", timeout=30)
            response.raise_for_status()
            
            console.print(f"[green]Job {job_id} cancelled[/green]")
            
        except httpx.HTTPStatusError as e:
            console.print(f"[red]Error: {e.response.text}[/red]")
            sys.exit(1)


@app.command()
def health():
    """Check API health status"""
    api_url = get_api_url()
    
    try:
        response = httpx.get(f"{api_url}/health", timeout=10)
        response.raise_for_status()
        data = response.json()
        
        table = Table(title="Health Status")
        table.add_column("Service", style="cyan")
        table.add_column("Status", style="white")
        
        for service, status in data.get("services", {}).items():
            color = "green" if status == "ok" else "red"
            table.add_row(service.upper(), f"[{color}]{status}[/{color}]")
        
        console.print(table)
        
    except httpx.ConnectError:
        console.print(f"[red]Cannot connect to API at {api_url}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    app()
