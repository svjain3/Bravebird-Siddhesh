# Ephemeral Environment Orchestration System

A production-ready AWS system for provisioning ephemeral Fargate containers to execute "Computer Use" browser automation tasks.

## 🎯 Core Objective

This system implements a **functional pipeline** that:

1. **Accepts a Job** → FastAPI REST API + CLI
2. **Provisions an Environment** → ECS Fargate containers (Spot for cost savings)
3. **Executes & Reaps** → Playwright browser agent, uploads to S3, auto-destroys

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    AWS Cloud                                         │
│                                                                                      │
│  ┌────────────────────────────────── VPC ──────────────────────────────────────┐    │
│  │                                                                              │    │
│  │   ┌─────────────── Public Subnet ───────────────┐                           │    │
│  │   │                                              │                           │    │
│  │   │   ┌─────────────┐      ┌──────────────┐     │                           │    │
│  │   │   │  API (ECS)  │      │ NAT Gateway  │◄────┼───── Internet Egress      │    │
│  │   │   │  FastAPI    │      └──────────────┘     │                           │    │
│  │   │   └──────┬──────┘                           │                           │    │
│  │   └──────────┼──────────────────────────────────┘                           │    │
│  │              │                                                               │    │
│  │   ┌──────────┼────────── Private Subnet ────────────────────────────────┐   │    │
│  │   │          │                                                           │   │    │
│  │   │          ▼                                                           │   │    │
│  │   │   ┌─────────────┐         ┌────────────────────────────────────┐    │   │    │
│  │   │   │   Lambda    │────────►│      ECS Fargate (Spot)            │    │   │    │
│  │   │   │ Dispatcher  │         │  ┌─────────────────────────────┐   │    │   │    │
│  │   │   └──────▲──────┘         │  │  Agent Container            │   │    │   │    │
│  │   │          │                │  │  • Playwright Browser       │   │    │   │    │
│  │   │          │                │  │  • Screenshot Capture       │   │    │   │    │
│  │   │          │                │  │  • StopTimeout: 10min       │   │    │   │    │
│  │   │          │                │  └─────────────────────────────┘   │    │   │    │
│  │   │          │                └────────────────────────────────────┘    │   │    │
│  │   │          │                              │                           │   │    │
│  │   │   IMDS Blocked (NACL)                   │                           │   │    │
│  │   └─────────────────────────────────────────┼───────────────────────────┘   │    │
│  └─────────────────────────────────────────────┼───────────────────────────────┘    │
│                                                │                                     │
│  ┌──────────────────── Managed Services ───────┼──────────────────────────────┐     │
│  │                                             │                               │     │
│  │  ┌─────────────┐  ┌─────────────┐    ┌─────▼─────┐    ┌───────────────┐   │     │
│  │  │     SQS     │  │  DynamoDB   │    │    S3     │    │    Secrets    │   │     │
│  │  │ FIFO Queues │  │             │    │           │    │    Manager    │   │     │
│  │  │             │  │ ┌─────────┐ │    │Screenshots│    │               │   │     │
│  │  │ ┌─────────┐ │  │ │  Jobs   │ │    │  Videos   │    │  API Keys     │   │     │
│  │  │ │  High   │ │  │ └─────────┘ │    │  Logs     │    │  Credentials  │   │     │
│  │  │ ├─────────┤ │  │ ┌─────────┐ │    │           │    │               │   │     │
│  │  │ │ Normal  │ │  │ │  Rate   │ │    │ 7-day     │    │ Native ECS    │   │     │
│  │  │ ├─────────┤ │  │ │ Limits  │ │    │ Lifecycle │    │ Injection     │   │     │
│  │  │ │   Low   │ │  │ └─────────┘ │    │           │    │               │   │     │
│  │  │ ├─────────┤ │  │             │    └───────────┘    └───────────────┘   │     │
│  │  │ │   DLQ   │ │  │             │                                         │     │
│  │  │ └─────────┘ │  │             │    ┌───────────────────────────────┐   │     │
│  │  └─────────────┘  └─────────────┘    │       CloudWatch Logs         │   │     │
│  │                                       │   Real-time → WebSocket API   │   │     │
│  │                                       └───────────────────────────────┘   │     │
│  └───────────────────────────────────────────────────────────────────────────┘     │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧪 Local Testing (Full Automated Pipeline)

### Prerequisites
- Docker Desktop (v20+)
- Python 3.10+
- curl, jq

### Quick Start

```bash
# Terminal 1: Start services (LocalStack + API)
make local

# Terminal 2: Start worker (auto-processes jobs)
make worker

# Terminal 3: Submit jobs (processed automatically!)
curl -X POST http://localhost:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com","user_id":"demo","priority":"high"}'
```

### Step-by-Step

#### 1. Start the Stack
```bash
make local
# Wait for "API running at http://localhost:8000"
```

#### 2. Verify Services
```bash
curl http://localhost:8000/health
# {"status":"ok","version":"0.1.0","services":{"sqs":"ok","dynamodb":"ok","s3":"ok"}}
```

#### 3. Build Agent Image
```bash
make build
# Built ephemeral-agent:latest and ephemeral-api:latest
```

#### 4. Start the Worker (in a new terminal)
```bash
make worker
# ============================================================
#   EPHEMERAL WORKER - Local Job Processor
# ============================================================
# Polling SQS queues for jobs...
# [Worker] Monitoring 3 queues...
```

#### 5. Submit a Job
```bash
curl -X POST http://localhost:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://amazon.com","user_id":"test","priority":"high"}'
```

#### 6. Watch the Automation
The worker automatically:
```
[Worker] Received job from HIGH: job-01KGFNVPE...
[Worker] Launching container...
[Agent] Navigating to https://amazon.com...
[Agent] Taking screenshot...
[Agent] Uploading screenshot to S3...
[Agent] Agent completed successfully in 7.8s
[Worker] Container destroyed, message deleted from queue
```

#### 7. Verify Job Completed
```bash
curl http://localhost:8000/jobs/<job_id> | jq .
# {"status":"completed","result":{"screenshot_url":"...", "duration_seconds": 7.8}}
```

#### 8. View Screenshot
```bash
open /tmp/agent-output/screenshot.png  # macOS
```

#### 9. Cleanup
```bash
make down
```

---

## ☁️ AWS Production Deployment

### Prerequisites
- AWS CLI configured (`aws configure`)
- Terraform >= 1.5.0
- Docker

### Step-by-Step

#### 1. Create ECR Repositories
```bash
export AWS_REGION=us-east-1
aws ecr create-repository --repository-name ephemeral-agent
aws ecr create-repository --repository-name ephemeral-api
```

#### 2. Build and Push Docker Images
```bash
make ecr-login
make push
```

#### 3. Create Terraform Variables
```bash
cd terraform
cat > terraform.tfvars <<EOF
aws_region = "us-east-1"
environment = "production"
agent_image = "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/ephemeral-agent:latest"
api_image = "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/ephemeral-api:latest"
EOF
```

#### 4. Deploy Infrastructure
```bash
make deploy
# or: cd terraform && terraform init && terraform apply
```

#### 5. Get API Endpoint
```bash
export API_URL=$(cd terraform && terraform output -raw api_endpoint)
echo "API available at: $API_URL"
```

#### 6. Test the Production System
```bash
# Health check
curl $API_URL/health

# Submit a job
curl -X POST $API_URL/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com","user_id":"prod-test","priority":"high"}'

# Check job status
curl $API_URL/jobs/<job_id>
```

#### 7. Monitor in AWS Console
- **ECS** → Clusters → `ephemeral-agents` → Tasks
- **CloudWatch Logs** → `/ecs/ephemeral-agent`
- **DynamoDB** → Tables → `jobs`
- **S3** → `ephemeral-artifacts-*` bucket

#### 8. Cleanup (Stop Billing!)
```bash
make destroy

# Delete ECR repositories
aws ecr delete-repository --repository-name ephemeral-agent --force
aws ecr delete-repository --repository-name ephemeral-api --force
```

---

## 📋 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/jobs` | Submit new job |
| `GET` | `/jobs/{id}` | Get job status + results |
| `DELETE` | `/jobs/{id}` | Cancel job |
| `WS` | `/jobs/{id}/logs` | Stream logs (WebSocket) |
| `GET` | `/health` | Health check |

### Submit Job Request
```json
{
  "url": "https://example.com",
  "user_id": "user-123",
  "priority": "high",       // high | normal | low
  "timeout_seconds": 300    // max 600
}
```

### Job Status Response
```json
{
  "job_id": "job-01HQXYZ...",
  "status": "completed",
  "result": {
    "screenshot_url": "https://s3.../screenshot.png",
    "exit_code": 0,
    "duration_seconds": 7.97
  }
}
```

---

## 🔬 5 Platform Deep-Dives

### 1. High-Performance Networking
| Requirement | Solution |
|-------------|----------|
| Agent internet access | NAT Gateway in public subnet |
| Block AWS metadata | NACL denies `169.254.169.254` |
| VPC isolation | Private subnet, no public IPs |
| Egress control | Security groups allow 80/443 only |

### 2. Concurrency & Scheduling
| Requirement | Solution |
|-------------|----------|
| 50+ simultaneous jobs | SQS buffers, Fargate auto-scales |
| Priority scheduling | 3 FIFO queues (high/normal/low) |
| Per-user rate limiting | DynamoDB atomic counter + TTL |
| Job deduplication | SQS content-based deduplication |

### 3. Observability & "Flight Recorder"
| Requirement | Solution |
|-------------|----------|
| Real-time logs | Firelens → CloudWatch → WebSocket |
| Screenshot capture | S3 with pre-signed URLs (1hr TTL) |
| Health monitoring | ECS native health checks |
| Hung task detection | No heartbeat = unhealthy |

### 4. Cost Control & Efficiency
| Requirement | Solution |
|-------------|----------|
| Reduce compute cost | Fargate Spot (70% savings) |
| Prevent runaway tasks | ECS `stopTimeout` (10 min max) |
| Failed job handling | DLQ after 3 retries |
| Storage cleanup | S3 lifecycle policy (7 days) |

### 5. Security & Multi-tenancy
| Requirement | Solution |
|-------------|----------|
| Secret injection | Secrets Manager → ECS native (never logged) |
| IAM separation | TaskRole (agent) vs ExecutionRole (ECS) |
| Task isolation | Per-task ENI, isolated PID/memory |
| No credential exposure | IMDS blocked, no AWS CLI in container |

---

## 📁 Project Structure

```
├── src/
│   ├── api/              # FastAPI server
│   │   ├── main.py       # Routes and handlers
│   │   ├── models.py     # Pydantic models
│   │   └── config.py     # Configuration
│   ├── scheduler/        # Job processing
│   │   ├── dispatcher.py # Lambda (AWS)
│   │   └── worker.py     # Local worker
│   └── cli/              # Command-line tool
├── agent/                # Playwright browser agent
│   ├── agent.py          # Browser automation
│   └── requirements.txt
├── docker/               # Dockerfiles
│   ├── Dockerfile.api
│   └── Dockerfile.agent
├── terraform/            # AWS infrastructure (IaC)
│   ├── main.tf           # VPC, NAT, Security Groups
│   ├── ecs.tf            # Fargate, Task Definitions
│   ├── sqs.tf            # Priority Queues
│   ├── storage.tf        # S3, DynamoDB
│   ├── lambda.tf         # Dispatcher
│   └── alb.tf            # Load Balancer
├── tests/                # Test suite
├── docker-compose.yml    # Local dev environment
├── Makefile              # Build automation
└── TESTING.md            # Detailed testing guide
```

---

## ⚠️ Failure Modes

| Failure | System Response |
|---------|-----------------|
| Task fails to start | Lambda retries 3x → DLQ |
| Task hangs forever | StopTimeout kills at 10min |
| Spot interruption | ECS reschedules on on-demand |
| Network partition | NAT Gateway HA across AZs |
| Lambda throttled | SQS retains messages (24hr) |

---

## 💰 Cost Estimate

| Resource | Monthly Cost |
|----------|--------------|
| NAT Gateway | ~$32 |
| Fargate (100 jobs/day) | ~$15 |
| Lambda | Free tier |
| DynamoDB | ~$1 |
| S3 | ~$1 |
| **Total** | **~$50/month** |

---

## 🔄 Design Tradeoffs

| Decision | Rationale | Alternative |
|----------|-----------|-------------|
| Fargate over EC2 | No AMI management, fast scaling | EC2 for GPUs |
| SQS over Redis | Managed, built-in DLQ | Redis for <10ms latency |
| Lambda Dispatcher | Scales to zero, cheap | ECS for warm pool |
| Python | Playwright support | Go for lower memory |
| FIFO Queues | Ordering guarantees | Standard for higher throughput |

---

## 🔮 Future Improvements

With more time, I would add:

1. **Video Recording** - Capture full session recordings using Playwright's video API
2. **Warm Pools** - Pre-provision containers for sub-second cold starts
3. **Geographic Distribution** - Multi-region deployment with Route53 routing
4. **GPU Support** - EC2 G4dn instances for ML-based agents
5. **Session Persistence** - Store browser cookies/state between jobs

---

## 📜 License

MIT
