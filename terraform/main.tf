# Ephemeral Environment Infrastructure - Terraform

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "ephemeral-agents"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Data source for availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# VPC
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"
  
  name = "ephemeral-agents-vpc"
  cidr = "10.0.0.0/16"
  
  azs             = slice(data.aws_availability_zones.available.names, 0, 2)
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]
  
  enable_nat_gateway     = var.enable_nat_gateway
  single_nat_gateway     = var.environment != "production"
  enable_dns_hostnames   = true
  enable_dns_support     = true
  
  # VPC Flow Logs
  enable_flow_log                      = true
  create_flow_log_cloudwatch_log_group = true
  create_flow_log_cloudwatch_iam_role  = true
  
  tags = {
    Name = "ephemeral-agents-vpc"
  }
}

# Security Group for Agent Tasks - Blocks IMDS
resource "aws_security_group" "agent" {
  name        = "ephemeral-agent-sg"
  description = "Security group for ephemeral agent tasks"
  vpc_id      = module.vpc.vpc_id
  
  # Allow all egress except IMDS
  egress {
    description = "Allow HTTPS egress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    description = "Allow HTTP egress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  # No ingress - agents don't need inbound access
  
  tags = {
    Name = "ephemeral-agent-sg"
  }
}

# NACL to block IMDS
resource "aws_network_acl" "agent_nacl" {
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets
  
  # Deny IMDS
  egress {
    rule_no    = 50
    action     = "deny"
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidr_block = "169.254.169.254/32"
  }
  
  # Allow all other egress
  egress {
    rule_no    = 100
    action     = "allow"
    protocol   = "-1"
    from_port  = 0
    to_port    = 0
    cidr_block = "0.0.0.0/0"
  }
  
  # Allow all ingress - Security Group handles stateful filtering
  ingress {
    rule_no    = 100
    action     = "allow"
    protocol   = "-1"
    from_port  = 0
    to_port    = 0
    cidr_block = "0.0.0.0/0"
  }
  
  tags = {
    Name = "ephemeral-agent-nacl"
  }
}
