
## 🖥️ Local Testing

### Prerequisites
- Docker Desktop running
- Python 3.11+

### Start the Stack
From the root directory of the repository:
```bash
# Terminal 1: Start LocalStack + API
docker-compose up

# Terminal 2: Start job processor
make worker
```

### Submit a Job (API)
```bash
# Replace URL with any site to capture a screenshot
curl -X POST http://localhost:8000/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com","user_id":"dev-user"}'
```

### Check Status
```bash
# Use the job_id from the submission response to track progress
curl http://localhost:8000/jobs/<JOB_ID>
```

### Submit a Job (CLI)
```bash
pip install -e .
export EPHEMERAL_API_URL="http://localhost:8000"

# Use --priority to control processing order (high/normal/low)
ephemeral submit --url https://github.com --user-id dev-user --priority high
ephemeral status <JOB_ID>
ephemeral logs <JOB_ID>
```


---

## ☁️ AWS Deployment

### Prerequisites
- AWS CLI configured (`aws configure`)
- Docker installed
- Terraform installed

### Deploy
```bash
make ecr-login && make push && make deploy
```

### Get API Endpoint
```bash
cd terraform && terraform output api_endpoint
```

---

## 🧪 AWS Testing (For Evaluators)

> **Note**: I have already deployed the system. You can test using my live endpoint below.

### Live Endpoint
```
http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com
```

### Test 1: Health Check
```bash
curl http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com/health
```

### Test 2: Submit a Job (API)
```bash
# Submit any URL; agent will capture a full-page screenshot
curl -X POST http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com/jobs \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","user_id":"evaluator"}'
```

### Test 2: Submit a Job (CLI)
```bash
export EPHEMERAL_API_URL="http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com"

# Set priority to 'high' for immediate processing
ephemeral submit --url https://example.com --user-id evaluator --priority high
ephemeral status <JOB_ID>
ephemeral logs <JOB_ID>
```

### Test 3: Check Status
```bash
# Use the job_id returned during submission
curl http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com/jobs/<JOB_ID>
```
Wait 30-60s for `completed`. Result includes a signed S3 link to the screenshot.

### Test 4: Burst Test
```bash
API_URL="http://ephemeral-api-alb-775648829.us-east-1.elb.amazonaws.com"
for i in {1..10}; do
  curl -s -X POST "$API_URL/jobs" -H "Content-Type: application/json" \
    -d "{\"url\":\"https://example.com/page-$i\",\"user_id\":\"burst-test\"}" &
done
wait
```

---

## API Reference

| Endpoint | Method | Description |
|:---|:---|:---|
| `/jobs` | POST | Submit job (returns unique `job_id`) |
| `/jobs/{id}` | GET | Track status (queued -> running -> completed) |
| `/health` | GET | Health check |

### POST /jobs
```json
{
  "url": "https://example.com",
  "user_id": "your-user-id",
  "priority": "normal"  // optional: high/normal/low (default: normal)
}
```

---

## Configuration

| Setting | Default | Description |
|:---|:---|:---|
| `rate_limit_per_minute` | 50 | Max jobs per user per minute |
| `job_timeout_seconds` | 600 | Max execution time |

---

## 🗑️ Cleanup
```bash
make destroy
```

---

## ⚠️ Failure Modes & Resilience

| Failure Scenario | System Behavior |
|:---|:---|
| **Container fails to start** | Lambda logs error, job status -> `failed`, visible via API |
| **Agent crashes mid-execution** | ECS detects exit, logs flushed to CloudWatch, job marked `failed` |
| **Fargate Spot interruption** | 2-minute warning, container SIGTERM'd, retryable via DLQ |
| **Rate limit exceeded** | API returns 429, user retries with backoff |

### Dead Letter Queue (DLQ)
Messages failing 3x go to `jobs-dlq.fifo`. Production would alarm on DLQ depth.

### Timeout Protection
- `StopTimeout` capped at 120s prevents zombie containers
- Job-level timeout (default 600s) kills long-running agents
