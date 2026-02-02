# Testing Guide

Complete guide to testing the Ephemeral Environment Orchestration System locally and on AWS.

---

## Prerequisites

### Local Testing
- Docker Desktop (v20+)
- Python 3.10+
- curl or httpie

### AWS Testing
- AWS CLI configured (`aws configure`)
- Terraform 1.5+
- Docker (for building images)
- ECR repository or Docker Hub account

---

## Local Testing with Docker Compose

### 1. Start the Stack

```bash
cd /Users/siddheshjain/.gemini/antigravity/scratch/bravebird-ephemeral-infra

# Start LocalStack, API, and other services
docker-compose up -d

# Wait for LocalStack to be ready (~15 seconds)
docker-compose logs -f localstack
# Wait until you see "Ready."
```

### 2. Verify Services are Running

```bash
# Check all containers
docker-compose ps

# Health check
curl http://localhost:8000/health
```

Expected response:
```json
{"status":"ok","version":"0.1.0","services":{"sqs":"ok","dynamodb":"ok","s3":"ok"}}
```

### 3. Submit a Test Job

```bash
# Submit job
curl -X POST http://localhost:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "user_id": "test-user",
    "priority": "normal",
    "timeout_seconds": 300
  }'
```

Expected response:
```json
{"job_id":"job-01HQXYZ...","status":"queued"}
```

**Save the job_id for next steps!**

### 4. Check Job Status

```bash
# Replace <job_id> with actual job ID
curl http://localhost:8000/jobs/<job_id>
```

### 5. Verify DynamoDB Entry

```bash
# Check job in DynamoDB (LocalStack)
docker exec -it bravebird-ephemeral-infra-localstack-1 \
  awslocal dynamodb get-item \
  --table-name jobs \
  --key '{"pk":{"S":"<job_id>"}}'
```

### 6. Check SQS Queue

```bash
# List queues
docker exec -it bravebird-ephemeral-infra-localstack-1 \
  awslocal sqs list-queues

# Get message count
docker exec -it bravebird-ephemeral-infra-localstack-1 \
  awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/jobs-normal.fifo \
  --attribute-names ApproximateNumberOfMessages
```

### 7. Using the CLI

```bash
# Install the package
pip install -e .

# Submit job
python -m src.cli.cli submit --url https://github.com --user-id demo

# Check status
python -m src.cli.cli status <job_id>

# Check health
python -m src.cli.cli health
```

### 8. Cleanup

```bash
docker-compose down -v
```

---

## Testing with Real Agent Execution (Local Docker)

To test the full flow including the agent running:

### 1. Build Agent Image

```bash
cd /Users/siddheshjain/.gemini/antigravity/scratch/bravebird-ephemeral-infra

# Build agent image
docker build -t ephemeral-agent:latest -f docker/Dockerfile.agent .
```

### 2. Run Agent Manually

```bash
# Create output directory
mkdir -p /tmp/agent-test

# Run agent container
docker run --rm \
  -e JOB_ID=test-job-001 \
  -e TARGET_URL=https://example.com \
  -e TIMEOUT_SECONDS=120 \
  -e S3_BUCKET=job-artifacts \
  -e DYNAMODB_TABLE=jobs \
  -e AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  -e AWS_ACCESS_KEY_ID=test \
  -e AWS_SECRET_ACCESS_KEY=test \
  -v /tmp/agent-test:/output \
  ephemeral-agent:latest
```

### 3. Check Output

```bash
# View screenshot
ls -la /tmp/agent-test/
open /tmp/agent-test/screenshot.png  # macOS
```

---

## AWS Deployment Testing

### 1. Set Up ECR Repositories

```bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create ECR repositories
aws ecr create-repository --repository-name ephemeral-agent
aws ecr create-repository --repository-name ephemeral-api

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

### 2. Build and Push Images

```bash
cd /Users/siddheshjain/.gemini/antigravity/scratch/bravebird-ephemeral-infra

# Build images
docker build -t ephemeral-agent:latest -f docker/Dockerfile.agent .
docker build -t ephemeral-api:latest -f docker/Dockerfile.api .

# Tag for ECR
docker tag ephemeral-agent:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ephemeral-agent:latest
docker tag ephemeral-api:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ephemeral-api:latest

# Push to ECR
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ephemeral-agent:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/ephemeral-api:latest
```

### 3. Deploy Infrastructure

```bash
cd /Users/siddheshjain/.gemini/antigravity/scratch/bravebird-ephemeral-infra/terraform

# Create terraform.tfvars
cat > terraform.tfvars << EOF
aws_region = "us-east-1"
environment = "development"
agent_image = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/ephemeral-agent:latest"
api_image = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/ephemeral-api:latest"
EOF

# Initialize and apply
terraform init
terraform plan
terraform apply
```

### 4. Get API Endpoint

```bash
# Get the ALB DNS name
export API_URL=$(terraform output -raw api_endpoint)
echo "API URL: $API_URL"

# Wait for ECS service to be healthy (~2-3 minutes)
# Check in AWS Console: ECS > Clusters > ephemeral-agents > Services
```

### 5. Test on AWS

```bash
# Health check
curl $API_URL/health

# Submit job
curl -X POST $API_URL/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://aws.amazon.com",
    "user_id": "aws-test",
    "priority": "high"
  }'

# Check status (replace job_id)
curl $API_URL/jobs/<job_id>
```

### 6. Monitor in AWS Console

- **ECS**: Check running tasks in cluster `ephemeral-agents`
- **CloudWatch Logs**: View `/ecs/ephemeral-agent` log group
- **DynamoDB**: Check `jobs` table for status updates
- **S3**: Look for screenshots in the `ephemeral-artifacts-*` bucket

### 7. Cleanup (Important!)

```bash
cd /Users/siddheshjain/.gemini/antigravity/scratch/bravebird-ephemeral-infra/terraform

# Destroy all resources
terraform destroy

# Delete ECR images (to avoid storage costs)
aws ecr delete-repository --repository-name ephemeral-agent --force
aws ecr delete-repository --repository-name ephemeral-api --force
```

---

## Troubleshooting

### LocalStack Issues

```bash
# Restart LocalStack
docker-compose restart localstack

# Check LocalStack logs
docker-compose logs localstack

# Verify resources exist
docker exec -it bravebird-ephemeral-infra-localstack-1 awslocal sqs list-queues
docker exec -it bravebird-ephemeral-infra-localstack-1 awslocal dynamodb list-tables
docker exec -it bravebird-ephemeral-infra-localstack-1 awslocal s3 ls
```

### API Connection Issues

```bash
# Check API logs
docker-compose logs api

# Restart API
docker-compose restart api
```

### ECS Task Failures (AWS)

```bash
# Check task status
aws ecs describe-tasks --cluster ephemeral-agents --tasks <task-arn>

# View stopped task reasons
aws ecs describe-tasks --cluster ephemeral-agents --tasks <task-arn> \
  --query 'tasks[0].stoppedReason'
```

---

## Expected E2E Flow

```
1. POST /jobs → API creates job in DynamoDB (status: queued)
2. API enqueues message to SQS FIFO queue
3. Lambda dispatcher triggered by SQS
4. Lambda calls ECS RunTask (Fargate)
5. Lambda updates DynamoDB (status: running)
6. Agent container starts
7. Agent navigates to URL, takes screenshot
8. Agent uploads screenshot to S3
9. Agent updates DynamoDB (status: completed, with result)
10. GET /jobs/:id returns completed status with pre-signed S3 URL
```
