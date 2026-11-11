mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/mock/1", dns_name = "mock.us-east-1.elb.amazonaws.com" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/mock/1" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/mock/1/1" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:cluster/mock", id = "arn:aws:ecs:us-east-1:123456789012:cluster/mock" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = { arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/mock:1" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com/mock" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Principal\":{\"Service\":\"ecs-tasks.amazonaws.com\"}}]}"
    }
  }
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
}

mock_provider "random" {}

variables {
  agentcore_agent_arn = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example-abc123"
}

run "bootstrap" {
  command = apply

  assert {
    condition     = alltrue([for service in aws_ecs_service.app : service.desired_count == 0])
    error_message = "Bootstrap must not start tasks before ECR images exist."
  }
  assert {
    condition     = alltrue([for service in aws_ecs_service.app : !service.network_configuration[0].assign_public_ip])
    error_message = "Tasks must stay in private subnets without public IPs."
  }
  assert {
    condition     = aws_cloudfront_distribution.main.ordered_cache_behavior[0].path_pattern == "/api" && aws_cloudfront_distribution.main.ordered_cache_behavior[1].path_pattern == "/api/*"
    error_message = "CloudFront must explicitly route both API path forms."
  }
  assert {
    condition     = contains([for entry in jsondecode(aws_ecs_task_definition.app["backend"].container_definitions)[0].environment : "${entry.name}=${entry.value}"], "AGENTCORE_AGENT_ARN=${var.agentcore_agent_arn}")
    error_message = "The backend task must receive the AgentCore ARN."
  }
}

run "enabled" {
  command = apply
  variables {
    services_enabled = true
    desired_count    = 2
    image_tag        = "release-2"
  }
  assert {
    condition     = alltrue([for service in aws_ecs_service.app : service.desired_count == 2])
    error_message = "Enabling services must honor desired_count."
  }
  assert {
    condition     = contains(jsondecode(aws_iam_role_policy.agentcore.policy).Statement[0].Resource, var.agentcore_agent_arn)
    error_message = "Only the configured agent runtime should be invokable."
  }
}
