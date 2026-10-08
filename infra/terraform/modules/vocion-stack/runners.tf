# modules/vocion-stack — the installation's engineering runners (off by default).
#
# With runners_enabled, one Fargate task runs per queued engineering run,
# started by the app at dispatch: the box's role may RunTask these two task
# definitions in this cluster and pass their two roles, nothing else. An
# optional EventBridge schedule (runner_poll_schedule) starts one poll-mode
# task as the fallback for a push that failed.
#
# The app reads the targets as VOCION_RUNNERS from the SSM parameter below
# (names only, never secrets); vocion-deploy adds it, and the runner token
# from the runner secret, to the env on every deploy. The runner's secrets are
# one Secrets Manager secret whose value this module never holds.

locals {
  runners          = var.runners_enabled ? 1 : 0
  runner_name      = "${var.name_prefix}-runner"
  runner_log_group = "/${var.name_prefix}/runner"
  runner_git_email = var.runner_git_email != "" ? var.runner_git_email : "runner@${var.hostname}"

  # The throwaway database beside a runner whose repository's checks need one.
  # It lives and dies with the task and is reachable only from inside it, so
  # these are fixed development values, never a credential.
  runner_db = { user = "runner", password = "runner", name = "runner", port = 5432 }
  runner_db_url = format(
    "postgresql://%s:%s@localhost:%d/%s",
    local.runner_db.user, local.runner_db.password, local.runner_db.port, local.runner_db.name,
  )

  runner_environment_base = [
    { name = "VOCION_URL", value = local.app_url },
    { name = "RUNNER_TARGET", value = "aws-fargate" },
    { name = "RUNNER_CLAIM_AFTER", value = "0" },
    { name = "POLL_MAX_SECONDS", value = "60" },
    { name = "MAX_BUDGET_USD", value = tostring(var.runner_max_budget_usd) },
    { name = "WALL_CLOCK_MINUTES", value = tostring(var.runner_wall_clock_minutes) },
    { name = "GIT_AUTHOR_NAME", value = "Vocion Runner" },
    { name = "GIT_AUTHOR_EMAIL", value = local.runner_git_email },
  ]
  runner_environment = concat(local.runner_environment_base, local.runner_bedrock_environment)
}

resource "aws_secretsmanager_secret" "runner" {
  count = local.runners

  name                    = "${var.name_prefix}/runner"
  description             = "${var.hostname} engineering runners: VOCION_RUNNER_TOKEN (the app holds the same value), ANTHROPIC_API_KEY (not with runner_bedrock), a fallback GITHUB_TOKEN. JSON."
  recovery_window_in_days = var.secret_recovery_window_days
}

# The private image's pull credential, in the form ECS reads: {"username","password"}.
resource "aws_secretsmanager_secret" "runner_registry" {
  count = local.runners

  name                    = "${var.name_prefix}/runner-registry"
  description             = "Registry pull credential for the runner image: {\"username\",\"password\"}."
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_ecs_cluster" "runners" {
  count = local.runners

  name = local.runner_name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "runners" {
  count = local.runners

  cluster_name       = aws_ecs_cluster.runners[0].name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "runner" {
  count = local.runners

  name              = local.runner_log_group
  retention_in_days = 14
}

# Egress only: a runner calls Vocion, GitHub, the model and the package
# registries, and nothing calls it.
resource "aws_security_group" "runner" {
  count = local.runners

  name        = "${var.name_prefix}-runner"
  description = "Vocion engineering runners - egress only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name_prefix}-runner" }
}

resource "aws_vpc_security_group_egress_rule" "runner_all" {
  count = local.runners

  security_group_id = aws_security_group.runner[0].id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Pulls the image, writes the logs, and reads the runner's secrets into the container.
resource "aws_iam_role" "runner_execution" {
  count = local.runners

  name               = "${var.name_prefix}-runner-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "runner_execution" {
  count = local.runners

  role       = aws_iam_role.runner_execution[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "runner_execution_secret" {
  count = local.runners

  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.runner[0].arn, aws_secretsmanager_secret.runner_registry[0].arn]
  }
}

resource "aws_iam_role_policy" "runner_execution_secret" {
  count = local.runners

  name   = "${var.name_prefix}-runner-secret"
  role   = aws_iam_role.runner_execution[0].id
  policy = data.aws_iam_policy_document.runner_execution_secret[0].json
}

# What the runner itself may do in AWS: nothing, unless its engineer runs on
# Bedrock (runner_bedrock). It reaches Vocion and GitHub with tokens.
resource "aws_iam_role" "runner_task" {
  count = local.runners

  name               = "${var.name_prefix}-runner-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ----- the engineer on Bedrock (runner_bedrock) -----
#
# The same grant the box's role gets (compute.tf: the models in bedrock_models,
# in-region and through this geography's inference profiles), on the runner
# task role. The runner hands the engineer that role's credentials endpoint and
# region and nothing else from AWS (packages/runner/src/bedrock.mjs), and the
# engineer runs the geography's Sonnet profile unless a run names a model.

locals {
  runner_bedrock = var.runners_enabled && var.runner_bedrock ? 1 : 0

  # The default Sonnet, as agent-runtime's BEDROCK_DEFAULT and the app's main role name it.
  runner_bedrock_foundation_model = "anthropic.claude-sonnet-4-6"
  runner_bedrock_model = (
    var.bedrock_inference_profile_geography != ""
    ? "${var.bedrock_inference_profile_geography}.${local.runner_bedrock_foundation_model}"
    : local.runner_bedrock_foundation_model
  )

  runner_bedrock_environment = local.runner_bedrock == 1 ? [
    { name = "CLAUDE_CODE_USE_BEDROCK", value = "1" },
    { name = "AWS_REGION", value = local.region },
    { name = "ANTHROPIC_MODEL", value = local.runner_bedrock_model },
  ] : []

  # On Bedrock the model credential is the task role, so the secret carries no model key (ECS
  # refuses to start a task whose secret lacks a key it names).
  runner_secret_keys = local.runner_bedrock == 1 ? ["VOCION_RUNNER_TOKEN", "GITHUB_TOKEN"] : ["VOCION_RUNNER_TOKEN", "ANTHROPIC_API_KEY", "GITHUB_TOKEN"]
}

data "aws_iam_policy_document" "runner_bedrock" {
  count = local.runner_bedrock

  statement {
    sid     = "InvokeFoundationModels"
    effect  = "Allow"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = flatten([
      for r in local.bedrock_model_regions : [
        for m in var.bedrock_models : "arn:${local.partition}:bedrock:${r}::foundation-model/${m}"
      ]
    ])
  }

  dynamic "statement" {
    for_each = var.bedrock_inference_profile_geography != "" ? [var.bedrock_inference_profile_geography] : []
    content {
      sid     = "InvokeInferenceProfiles"
      effect  = "Allow"
      actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      resources = [
        for m in var.bedrock_models : "arn:${local.partition}:bedrock:${local.region}:${local.account_id}:inference-profile/${statement.value}.${m}"
      ]
    }
  }
}

resource "aws_iam_role_policy" "runner_bedrock" {
  count = local.runner_bedrock

  name   = "${var.name_prefix}-runner-bedrock"
  role   = aws_iam_role.runner_task[0].id
  policy = data.aws_iam_policy_document.runner_bedrock[0].json

  lifecycle {
    precondition {
      condition = anytrue([
        for m in var.bedrock_models :
        m == local.runner_bedrock_foundation_model || (endswith(m, "*") && startswith(local.runner_bedrock_foundation_model, trimsuffix(m, "*")))
      ])
      error_message = "runner_bedrock runs the engineer on ${local.runner_bedrock_foundation_model}, which bedrock_models does not allow. Add it (or anthropic.*)."
    }
  }
}

locals {
  runner_container = var.runners_enabled ? {
    name                  = "runner"
    image                 = var.runner_image
    repositoryCredentials = { credentialsParameter = aws_secretsmanager_secret.runner_registry[0].arn }
    essential             = true
    environment           = local.runner_environment
    secrets = [
      for k in local.runner_secret_keys :
      { name = k, valueFrom = "${aws_secretsmanager_secret.runner[0].arn}:${k}::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = local.runner_log_group
        awslogs-region        = local.region
        awslogs-stream-prefix = "runner"
      }
    }
  } : null

  runner_db_container = {
    name      = "runner-db"
    image     = "public.ecr.aws/docker/library/postgres:16-alpine"
    essential = false
    environment = [
      { name = "POSTGRES_USER", value = local.runner_db.user },
      { name = "POSTGRES_PASSWORD", value = local.runner_db.password },
      { name = "POSTGRES_DB", value = local.runner_db.name },
      { name = "PGPORT", value = tostring(local.runner_db.port) },
    ]
    healthCheck = {
      command     = ["CMD-SHELL", "pg_isready -U ${local.runner_db.user} -d ${local.runner_db.name} -p ${local.runner_db.port}"]
      interval    = 5
      timeout     = 3
      retries     = 10
      startPeriod = 5
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = local.runner_log_group
        awslogs-region        = local.region
        awslogs-stream-prefix = "runner-db"
      }
    }
  }
}

resource "aws_ecs_task_definition" "runner" {
  count = local.runners

  family                   = local.runner_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.runner_cpu
  memory                   = var.runner_memory
  execution_role_arn       = aws_iam_role.runner_execution[0].arn
  task_role_arn            = aws_iam_role.runner_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  ephemeral_storage {
    size_in_gib = 30
  }

  container_definitions = jsonencode([local.runner_container])
}

resource "aws_ecs_task_definition" "runner_db" {
  count = local.runners

  family                   = "${local.runner_name}-db"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.runner_cpu
  memory                   = var.runner_memory
  execution_role_arn       = aws_iam_role.runner_execution[0].arn
  task_role_arn            = aws_iam_role.runner_task[0].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  ephemeral_storage {
    size_in_gib = 30
  }

  container_definitions = jsonencode([
    merge(local.runner_container, {
      environment = concat(local.runner_environment, [{ name = "RUNNER_POSTGRES_URL", value = local.runner_db_url }])
      dependsOn   = [{ containerName = "runner-db", condition = "HEALTHY" }]
    }),
    local.runner_db_container,
  ])
}

# ----- the app starts a task per run (push at dispatch) -----

data "aws_iam_policy_document" "runner_dispatch" {
  count = local.runners

  statement {
    sid       = "RunRunnerTasks"
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = ["arn:${local.partition}:ecs:${local.region}:${local.account_id}:task-definition/${local.runner_name}*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.runners[0].arn]
    }
  }
  statement {
    sid       = "PassRunnerRoles"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.runner_execution[0].arn, aws_iam_role.runner_task[0].arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "runner_dispatch" {
  count = local.runners

  name   = "${var.name_prefix}-runner-dispatch"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.runner_dispatch[0].json
}

resource "aws_ssm_parameter" "runners" {
  count = local.runners

  name        = local.runners_param
  description = "${var.hostname} runner targets (VOCION_RUNNERS). Names only."
  type        = "String"
  value = jsonencode({
    targets = [
      {
        name                 = "aws-fargate"
        kind                 = "aws-fargate"
        region               = local.region
        cluster              = aws_ecs_cluster.runners[0].name
        taskDefinition       = aws_ecs_task_definition.runner[0].family
        taskDefinitionWithDb = aws_ecs_task_definition.runner_db[0].family
        subnets              = aws_subnet.public[*].id
        securityGroups       = [aws_security_group.runner[0].id]
        assignPublicIp       = true
        containerName        = "runner"
      },
    ]
  })
}

# ----- the fallback poll -----

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

locals {
  runner_poll = var.runners_enabled && var.runner_poll_schedule != "" ? 1 : 0
}

resource "aws_iam_role" "runner_scheduler" {
  count = local.runner_poll

  name               = "${var.name_prefix}-runner-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "runner_scheduler" {
  count = local.runner_poll

  statement {
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = ["${aws_ecs_task_definition.runner_db[0].arn_without_revision}:*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.runner_execution[0].arn, aws_iam_role.runner_task[0].arn]
  }
}

resource "aws_iam_role_policy" "runner_scheduler" {
  count = local.runner_poll

  name   = "${var.name_prefix}-runner-scheduler"
  role   = aws_iam_role.runner_scheduler[0].id
  policy = data.aws_iam_policy_document.runner_scheduler[0].json
}

# Starts one poll-mode runner (with a database, so it can take any run). It
# takes a run only once that run has waited a minute, so a pushed task always
# wins, and exits after a minute with nothing to do.
resource "aws_scheduler_schedule" "runner_poll" {
  count = local.runner_poll

  name       = "${var.name_prefix}-runner-poll"
  group_name = "default"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = var.runner_poll_schedule

  target {
    arn      = aws_ecs_cluster.runners[0].arn
    role_arn = aws_iam_role.runner_scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.runner_db[0].arn_without_revision
      launch_type         = "FARGATE"
      task_count          = 1

      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.runner[0].id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [{
        name        = "runner"
        environment = [{ name = "RUNNER_CLAIM_AFTER", value = "60" }]
      }]
    })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
