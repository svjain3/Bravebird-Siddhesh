# ECS Cluster and Task Definitions

# ECS Cluster with Fargate Spot
resource "aws_ecs_cluster" "main" {
  name = "ephemeral-agents"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
  
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 4
    base              = 0
  }
  
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1  # At least 1 on-demand for reliability
  }
}

# CloudWatch Log Group for agents
resource "aws_cloudwatch_log_group" "agent" {
  name              = "/ecs/ephemeral-agent"
  retention_in_days = 7
}

# Task Execution Role (for ECS to pull images, get secrets)
resource "aws_iam_role" "task_execution" {
  name = "ephemeral-task-execution-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name = "secrets-access"
  role = aws_iam_role.task_execution.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue"
      ]
      Resource = [aws_secretsmanager_secret.agent_credentials.arn]
    }]
  })
}

# Task Role (for the agent container to access S3, etc.)
resource "aws_iam_role" "task" {
  name = "ephemeral-task-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "task_s3" {
  name = "s3-and-dynamodb-access"
  role = aws_iam_role.task.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:UpdateItem"
        ]
        Resource = [aws_dynamodb_table.jobs.arn]
      }
    ]
  })
}

# Agent Task Definition
resource "aws_ecs_task_definition" "agent" {
  family                   = "ephemeral-agent"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn
  
  container_definitions = jsonencode([
    {
      name      = "agent"
      image     = var.agent_image
      essential = true
      
      # StopTimeout - max 120 seconds for Fargate
      stopTimeout = min(var.job_timeout_seconds, 120)
      
      # Secrets from Secrets Manager (never logged)
      secrets = [
        {
          name      = "API_KEY"
          valueFrom = aws_secretsmanager_secret.agent_credentials.arn
        }
      ]
      
      environment = [
        {
          name  = "S3_BUCKET"
          value = aws_s3_bucket.artifacts.id
        },
        {
          name  = "DYNAMODB_TABLE"
          value = aws_dynamodb_table.jobs.name
        }
      ]
      
      logConfiguration = {
        logDriver = "awsfirelens"
        options = {
          Name       = "cloudwatch"
          region     = var.aws_region
          log_group_name  = aws_cloudwatch_log_group.agent.name
          auto_create_group = "false"
        }
      }
      
      healthCheck = {
        command     = ["CMD-SHELL", "exit 0"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    },
    {
      name      = "log_router"
      image     = "amazon/aws-for-fluent-bit:stable"
      essential = true
      
      firelensConfiguration = {
        type = "fluentbit"
        options = {
          enable-ecs-log-metadata = "true"
        }
      }
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.agent.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "firelens"
        }
      }
      
      memoryReservation = 50
    }
  ])
}

# API Service Task Definition
resource "aws_ecs_task_definition" "api" {
  family                   = "ephemeral-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  
  container_definitions = jsonencode([
    {
      name      = "api"
      image     = var.api_image
      essential = true
      
      portMappings = [{
        containerPort = 8000
        protocol      = "tcp"
      }]
      
      environment = [
        {
          name  = "EPHEMERAL_AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "EPHEMERAL_SQS_QUEUE_HIGH"
          value = aws_sqs_queue.jobs_high.name
        },
        {
          name  = "EPHEMERAL_SQS_QUEUE_NORMAL"
          value = aws_sqs_queue.jobs_normal.name
        },
        {
          name  = "EPHEMERAL_SQS_QUEUE_LOW"
          value = aws_sqs_queue.jobs_low.name
        },
        {
          name  = "EPHEMERAL_DYNAMODB_TABLE"
          value = aws_dynamodb_table.jobs.name
        },
        {
          name  = "EPHEMERAL_S3_BUCKET"
          value = aws_s3_bucket.artifacts.id
        }
      ]
      
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/ephemeral-api"
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
      
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
}

# API Task Role
resource "aws_iam_role" "api_task" {
  name = "ephemeral-api-task-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "api_task" {
  name = "api-access"
  role = aws_iam_role.api_task.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueUrl"
        ]
        Resource = [
          aws_sqs_queue.jobs_high.arn,
          aws_sqs_queue.jobs_normal.arn,
          aws_sqs_queue.jobs_low.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query"
        ]
        Resource = [
          aws_dynamodb_table.jobs.arn,
          aws_dynamodb_table.rate_limits.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = ["${aws_s3_bucket.artifacts.arn}/*"]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:FilterLogEvents"
        ]
        Resource = ["${aws_cloudwatch_log_group.agent.arn}:*"]
      }
    ]
  })
}
