locals {
  apps = {
    frontend = { port = 3000, health = "/healthz" }
    backend  = { port = 3001, health = "/api/healthz" }
  }
}

resource "aws_ecr_repository" "app" {
  for_each             = local.apps
  name                 = "${var.project_name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = local.apps
  repository = aws_ecr_repository.app[each.key].name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after seven days"
      selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = local.apps
  name              = "/ecs/${var.project_name}/${each.key}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = var.project_name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name_prefix        = "${var.project_name}-execution-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  for_each           = local.apps
  name_prefix        = "${var.project_name}-${each.key}-"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "agentcore" {
  role = aws_iam_role.task["backend"].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
      Resource = [var.agentcore_agent_arn, "${var.agentcore_agent_arn}/runtime-endpoint/${var.agentcore_qualifier}"]
    }]
  })
}

resource "aws_ecs_task_definition" "app" {
  for_each                 = local.apps
  family                   = "${var.project_name}-${each.key}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task[each.key].arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = each.key
    image        = "${aws_ecr_repository.app[each.key].repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = each.value.port, hostPort = each.value.port, protocol = "tcp" }]
    environment = concat([
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(each.value.port) }
      ], each.key == "backend" ? [
      { name = "AGENT_MODE", value = "agentcore" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "AGENTCORE_AGENT_ARN", value = var.agentcore_agent_arn },
      { name = "AGENTCORE_QUALIFIER", value = var.agentcore_qualifier }
    ] : [])
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app[each.key].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:${each.value.port}${each.value.health}').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    stopTimeout = 30
  }])
  lifecycle {
    precondition {
      condition     = split(":", var.agentcore_agent_arn)[3] == var.aws_region
      error_message = "aws_region must match the AgentCore runtime ARN region."
    }
  }
}

resource "aws_ecs_service" "app" {
  for_each                           = local.apps
  name                               = "${var.project_name}-${each.key}"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.app[each.key].arn
  desired_count                      = var.services_enabled ? var.desired_count : 0
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  wait_for_steady_state              = true
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app[each.key].arn
    container_name   = each.key
    container_port   = each.value.port
  }
  depends_on = [
    aws_lb_listener.http, aws_lb_listener_rule.app,
    aws_iam_role_policy_attachment.execution, aws_iam_role_policy.agentcore,
    aws_route_table_association.private
  ]
}
