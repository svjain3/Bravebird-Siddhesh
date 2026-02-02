# Lambda Dispatcher - Processes SQS and launches Fargate tasks

data "archive_file" "dispatcher" {
  type        = "zip"
  source_file = "${path.module}/../src/scheduler/dispatcher.py"
  output_path = "${path.module}/dispatcher.zip"
}

resource "aws_lambda_function" "dispatcher" {
  function_name    = "ephemeral-job-dispatcher"
  filename         = data.archive_file.dispatcher.output_path
  source_code_hash = data.archive_file.dispatcher.output_base64sha256
  handler          = "dispatcher.handler"
  runtime          = "python3.11"
  timeout          = 60
  memory_size      = 256
  role             = aws_iam_role.dispatcher.arn
  
  environment {
    variables = {
      ECS_CLUSTER         = aws_ecs_cluster.main.name
      ECS_TASK_DEFINITION = aws_ecs_task_definition.agent.arn
      ECS_SUBNETS         = join(",", module.vpc.private_subnets)
      ECS_SECURITY_GROUPS = aws_security_group.agent.id
      DYNAMODB_TABLE      = aws_dynamodb_table.jobs.name
      AGENT_SECRET_ARN    = aws_secretsmanager_secret.agent_credentials.arn
    }
  }
}

# Lambda IAM Role
resource "aws_iam_role" "dispatcher" {
  name = "ephemeral-dispatcher-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dispatcher_basic" {
  role       = aws_iam_role.dispatcher.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "dispatcher" {
  name = "dispatcher-access"
  role = aws_iam_role.dispatcher.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
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
          "ecs:RunTask"
        ]
        Resource = [aws_ecs_task_definition.agent.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = [
          aws_iam_role.task_execution.arn,
          aws_iam_role.task.arn
        ]
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

# SQS triggers for Lambda
resource "aws_lambda_event_source_mapping" "high" {
  event_source_arn = aws_sqs_queue.jobs_high.arn
  function_name    = aws_lambda_function.dispatcher.arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "normal" {
  event_source_arn = aws_sqs_queue.jobs_normal.arn
  function_name    = aws_lambda_function.dispatcher.arn
  batch_size       = 1
}

resource "aws_lambda_event_source_mapping" "low" {
  event_source_arn = aws_sqs_queue.jobs_low.arn
  function_name    = aws_lambda_function.dispatcher.arn
  batch_size       = 1
}
