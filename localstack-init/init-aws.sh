#!/bin/bash
# LocalStack initialization script
# Creates required AWS resources

echo "Initializing LocalStack resources..."

# Create SQS queues
awslocal sqs create-queue --queue-name jobs-high.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
awslocal sqs create-queue --queue-name jobs-normal.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
awslocal sqs create-queue --queue-name jobs-low.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true
awslocal sqs create-queue --queue-name jobs-dlq.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true

# Create S3 bucket
awslocal s3 mb s3://job-artifacts

# Create DynamoDB tables
awslocal dynamodb create-table \
    --table-name jobs \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST

awslocal dynamodb create-table \
    --table-name rate-limits \
    --attribute-definitions AttributeName=pk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --time-to-live-specification AttributeName=ttl,Enabled=true

# Create Secrets Manager secret
awslocal secretsmanager create-secret \
    --name agent-credentials \
    --secret-string '{"API_KEY":"demo-key-12345"}'

echo "LocalStack initialization complete!"
