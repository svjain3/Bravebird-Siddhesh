# Application Load Balancer and ECS Service for API

# Security Group for ALB
resource "aws_security_group" "alb" {
  name        = "ephemeral-alb-sg"
  description = "Security group for API load balancer"
  vpc_id      = module.vpc.vpc_id
  
  ingress {
    description = "Allow HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    description = "Allow HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "ephemeral-alb-sg"
  }
}

# Security Group for API ECS Service
resource "aws_security_group" "api" {
  name        = "ephemeral-api-sg"
  description = "Security group for API ECS tasks"
  vpc_id      = module.vpc.vpc_id
  
  ingress {
    description     = "Allow from ALB"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  tags = {
    Name = "ephemeral-api-sg"
  }
}

# Application Load Balancer
resource "aws_lb" "api" {
  name               = "ephemeral-api-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnets
  
  enable_deletion_protection = var.environment == "production"
  
  tags = {
    Name = "ephemeral-api-alb"
  }
}

# ALB Target Group
resource "aws_lb_target_group" "api" {
  name        = "ephemeral-api-tg"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip"
  
  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = "/health"
    matcher             = "200"
  }
  
  tags = {
    Name = "ephemeral-api-tg"
  }
}

# ALB Listener (HTTP - redirect to HTTPS in production)
resource "aws_lb_listener" "api" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# CloudWatch Log Group for API
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/ephemeral-api"
  retention_in_days = 7
}

# ECS Service for API
resource "aws_ecs_service" "api" {
  name            = "ephemeral-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.environment == "production" ? 2 : 1
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets          = module.vpc.public_subnets
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true  # Needed for ECS Fargate in public subnets
  }
  
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8000
  }
  
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  
  depends_on = [aws_lb_listener.api]
  
  lifecycle {
    ignore_changes = [desired_count]
  }
}
