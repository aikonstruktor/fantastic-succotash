variable "aws_region" {
  description = "Region for ECS and the existing AgentCore runtime."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "simpleecs"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,19}$", var.project_name))
    error_message = "Use 3–20 lowercase letters, digits, or hyphens, starting with a letter."
  }
}

variable "agentcore_agent_arn" {
  description = "Existing IAM-authenticated AG-UI AgentCore runtime ARN. This stack does not create the agent."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:bedrock-agentcore:[a-z0-9-]+:[0-9]{12}:runtime/[A-Za-z0-9_-]+$", var.agentcore_agent_arn))
    error_message = "Provide an AgentCore runtime ARN, not a Bedrock Agents agent or endpoint ARN."
  }
}

variable "agentcore_qualifier" {
  type    = string
  default = "DEFAULT"
}

variable "services_enabled" {
  description = "Leave false for ECR bootstrap; set true only after pushing both images."
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "Unique immutable ECR tag shared by both images."
  type        = string
  default     = "v1"
  validation {
    condition     = can(regex("^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$", var.image_tag))
    error_message = "Provide a valid ECR image tag."
  }
}

variable "desired_count" {
  type    = number
  default = 1
  validation {
    condition     = var.desired_count >= 1 && floor(var.desired_count) == var.desired_count
    error_message = "desired_count must be a positive integer."
  }
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 8, 11))
    error_message = "Provide an IPv4 CIDR with room for the public and private subnets."
  }
}
