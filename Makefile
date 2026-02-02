.PHONY: local down dev test deploy destroy clean build push ecr-login

# Configuration
AWS_REGION ?= us-east-1
AWS_ACCOUNT_ID := $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REGISTRY = $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com

# Local development with LocalStack
local:
	docker-compose up -d
	@echo ""
	@echo "LocalStack running at http://localhost:4566"
	@echo "API running at http://localhost:8000"
	@echo ""
	@echo "Test with:"
	@echo "  curl http://localhost:8000/health"

# Stop local environment
down:
	docker-compose down -v

# Run API locally (without Docker)
dev:
	uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000

# Run tests
test:
	pytest tests/ -v

# Build Docker images
build:
	docker build -t ephemeral-agent:latest -f docker/Dockerfile.agent .
	docker build -t ephemeral-api:latest -f docker/Dockerfile.api .
	@echo "Built ephemeral-agent:latest and ephemeral-api:latest"

# Login to ECR
ecr-login:
	@aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(ECR_REGISTRY)

# Push to ECR (run 'make ecr-login' first)
push: build
	docker tag ephemeral-agent:latest $(ECR_REGISTRY)/ephemeral-agent:latest
	docker tag ephemeral-api:latest $(ECR_REGISTRY)/ephemeral-api:latest
	docker push $(ECR_REGISTRY)/ephemeral-agent:latest
	docker push $(ECR_REGISTRY)/ephemeral-api:latest
	@echo ""
	@echo "Pushed images to ECR:"
	@echo "  $(ECR_REGISTRY)/ephemeral-agent:latest"
	@echo "  $(ECR_REGISTRY)/ephemeral-api:latest"

# Deploy to AWS
deploy:
	cd terraform && terraform init && terraform apply -auto-approve
	@echo ""
	@echo "API Endpoint:"
	@cd terraform && terraform output api_endpoint

# Destroy AWS resources
destroy:
	cd terraform && terraform destroy -auto-approve

# Clean up
clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	docker-compose down -v --rmi local
	rm -rf terraform/.terraform terraform/.terraform.lock.hcl

# Run agent locally for testing
test-agent:
	@mkdir -p /tmp/agent-test
	docker run --rm \
		-e JOB_ID=test-job-$$(date +%s) \
		-e TARGET_URL=https://example.com \
		-e TIMEOUT_SECONDS=60 \
		-e S3_BUCKET=job-artifacts \
		-e DYNAMODB_TABLE=jobs \
		-e AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
		-e AWS_ACCESS_KEY_ID=test \
		-e AWS_SECRET_ACCESS_KEY=test \
		-e AWS_REGION=us-east-1 \
		-v /tmp/agent-test:/output \
		ephemeral-agent:latest
	@echo ""
	@echo "Screenshot saved to /tmp/agent-test/screenshot.png"

# Submit test job to local API
test-submit:
	@curl -s -X POST http://localhost:8000/jobs \
		-H "Content-Type: application/json" \
		-d '{"url":"https://example.com","user_id":"make-test","priority":"normal"}' | jq .

# Run local worker (polls SQS, runs containers automatically)
worker:
	@echo "Starting local worker - will automatically process jobs from SQS..."
	@python -m src.scheduler.worker

# Show help
help:
	@echo "Ephemeral Infrastructure - Available Commands"
	@echo ""
	@echo "Local Development:"
	@echo "  make local      - Start LocalStack + API with Docker Compose"
	@echo "  make down       - Stop and remove containers"
	@echo "  make dev        - Run API with hot reload (requires pip install -e .)"
	@echo "  make test       - Run pytest tests"
	@echo ""
	@echo "Testing:"
	@echo "  make build      - Build Docker images"
	@echo "  make test-agent - Run agent container locally"
	@echo "  make test-submit- Submit test job to local API"
	@echo ""
	@echo "AWS Deployment:"
	@echo "  make ecr-login  - Login to ECR"
	@echo "  make push       - Build and push images to ECR"
	@echo "  make deploy     - Deploy with Terraform"
	@echo "  make destroy    - Destroy AWS resources"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean      - Remove generated files"

