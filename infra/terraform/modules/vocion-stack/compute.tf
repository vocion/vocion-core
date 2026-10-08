# modules/vocion-stack — the box: security group, IAM, the EC2 instance and
# what it reads on every deploy.
#
# The box holds no database (RDS) and no media (S3). What it does keep — the
# Docker images, its build cache and the artifact directory — is rebuilt or
# regenerated, so replacing the box is a redeploy, not a restore.

data "aws_ec2_instance_type" "app" {
  instance_type = var.instance_type
}

locals {
  # Graviton types get the arm64 AMI; everything else x86_64.
  ami_arch = contains(data.aws_ec2_instance_type.app.supported_architectures, "x86_64") ? "x86_64" : "arm64"
  ami_id   = var.ami_id != "" ? var.ami_id : data.aws_ami.al2023[0].id
}

data "aws_ami" "al2023" {
  count = var.ami_id == "" ? 1 : 0

  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-${local.ami_arch}"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  filter {
    name   = "architecture"
    values = [local.ami_arch]
  }
}

# ----- security group -----

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = var.alb_enabled ? "Vocion box - HTTP from the ALB only" : "Vocion box - HTTP and HTTPS from anywhere (Caddy terminates TLS)"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.name_prefix}-app" }
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound (git, model APIs, image pulls, RDS)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  count = var.alb_enabled ? 1 : 0

  security_group_id            = aws_security_group.app.id
  description                  = "HTTP from the ALB"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.alb[0].id
}

resource "aws_vpc_security_group_ingress_rule" "app_public" {
  for_each = var.alb_enabled ? toset([]) : toset(["80", "443"])

  security_group_id = aws_security_group.app.id
  description       = each.key == "80" ? "HTTP (Caddy redirect + ACME HTTP-01)" : "HTTPS"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "app_ssh" {
  for_each = var.ssh_enabled ? toset(var.ssh_cidrs) : toset([])

  security_group_id = aws_security_group.app.id
  description       = "SSH from an operator range"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = each.key
}

# ----- IAM: what the box may do -----

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.name_prefix}-ec2"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Session Manager: the way in. No inbound port, every session logged by CloudTrail.
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "deploy_read" {
  statement {
    sid     = "ReadAppSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    # The env payload and the app's database login. Never the RDS-managed
    # master secret: the box (and so the app container, which shares the
    # instance role) has no business holding the admin password.
    resources = concat(
      [aws_secretsmanager_secret.app_env.arn, aws_secretsmanager_secret.rds_app.arn],
      var.runners_enabled ? [aws_secretsmanager_secret.runner[0].arn] : [],
    )
  }
  statement {
    sid     = "ReadDeployConfig"
    effect  = "Allow"
    actions = ["ssm:GetParameter"]
    resources = concat(
      [aws_ssm_parameter.deploy.arn],
      var.runners_enabled ? [aws_ssm_parameter.runners[0].arn] : [],
    )
  }
  statement {
    sid    = "WriteOwnLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/${var.name_prefix}/*"]
  }
}

resource "aws_iam_role_policy" "deploy_read" {
  name   = "${var.name_prefix}-deploy-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.deploy_read.json
}

data "aws_iam_policy_document" "vault" {
  count = var.kms_vault_enabled ? 1 : 0

  statement {
    sid       = "CredentialVault"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"]
    resources = [aws_kms_key.vault[0].arn]
  }
}

resource "aws_iam_role_policy" "vault" {
  count = var.kms_vault_enabled ? 1 : 0

  name   = "${var.name_prefix}-credential-vault"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.vault[0].json
}

data "aws_iam_policy_document" "agentcore" {
  count = var.agentcore_enabled ? 1 : 0

  statement {
    sid    = "AgentCoreHarness"
    effect = "Allow"
    actions = [
      "bedrock-agentcore:CreateHarness",
      "bedrock-agentcore:UpdateHarness",
      "bedrock-agentcore:GetHarness",
      "bedrock-agentcore:InvokeHarness",
      "bedrock-agentcore:ListHarnessVersions",
      "bedrock-agentcore:CreateAgentRuntime",
      "bedrock-agentcore:UpdateAgentRuntime",
      "bedrock-agentcore:GetAgentRuntime",
      "bedrock-agentcore:InvokeAgentRuntime",
      "bedrock-agentcore:InvokeAgentRuntimeForUser",
      "bedrock-agentcore:CreateMemory",
      "bedrock-agentcore:UpdateMemory",
      "bedrock-agentcore:GetMemory",
    ]
    resources = [
      "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:harness/*",
      "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:runtime/*",
      "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account_id}:memory/*",
    ]
  }
  statement {
    sid       = "AgentCoreList"
    effect    = "Allow"
    actions   = ["bedrock-agentcore:ListHarnesses"]
    resources = ["*"]
  }
  statement {
    sid       = "PassHarnessExecutionRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/${var.agentcore_harness_role_name}"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["bedrock-agentcore.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "agentcore" {
  count = var.agentcore_enabled ? 1 : 0

  name   = "${var.name_prefix}-agentcore"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.agentcore[0].json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.name_prefix}-ec2"
  role = aws_iam_role.ec2.name
}

# ----- what the box reads on every deploy -----
#
# One SSM parameter, read by vocion-deploy each run, so an apply that moves
# the database endpoint, adds a setting or turns the ALB on reaches the box on
# its next deploy without replacing it. Names and non-secret settings only:
# the values that are secret stay in Secrets Manager.

locals {
  # The env the module owns. app_env is merged over it, and both over the
  # app-env secret (templates/vocion-deploy.sh).
  module_env = merge(
    {
      VOCION_HOSTNAME     = var.hostname
      NEXT_PUBLIC_APP_URL = local.app_url
      AUTH_URL            = local.app_url
      AWS_REGION          = local.region
      VOCION_MEDIA_BUCKET = aws_s3_bucket.media.bucket
      VOCION_MEDIA_REGION = local.region
      # Off the container's writable layer, so artifacts survive a redeploy
      # (mounted by templates/compose.cloud.yml).
      VOCION_ARTIFACTS_DIR = "/var/lib/vocion/artifacts"
      # Langfuse is never self-hosted by this module: Langfuse Cloud (set
      # LANGFUSE_* in the secret) or off (LANGFUSE_ENABLED=false).
      LANGFUSE_SELF_HOSTED_REPLICAS = "0"
      # Caddy trusts X-Forwarded-* only from inside the VPC (the ALB).
      VOCION_TRUSTED_PROXIES = var.vpc_cidr
    },
    var.kms_vault_enabled ? {
      VOCION_CREDENTIAL_VAULT = "kms"
      VOCION_KMS_KEY_ARN      = aws_kms_key.vault[0].arn
    } : {},
  )

  deploy_config = {
    hostname         = var.hostname
    behind_alb       = var.alb_enabled
    app_secret_id    = aws_secretsmanager_secret.app_env.arn
    db_secret_id     = aws_secretsmanager_secret.rds_app.arn
    runners_param    = var.runners_enabled ? aws_ssm_parameter.runners[0].name : ""
    runner_secret_id = var.runners_enabled ? aws_secretsmanager_secret.runner[0].arn : ""
    db = {
      host  = aws_db_instance.main.address
      port  = tostring(aws_db_instance.main.port)
      name  = var.db_name
      major = local.db_major
    }
    env = merge(local.module_env, var.app_env)
  }
}

resource "aws_ssm_parameter" "deploy" {
  name        = local.deploy_param
  description = "vocion-stack deploy config for ${var.hostname}: names and non-secret settings, read by vocion-deploy on the box."
  type        = "String"
  tier        = "Intelligent-Tiering"
  value       = jsonencode(local.deploy_config)
}

# ----- the instance -----

resource "aws_instance" "app" {
  ami                         = local.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2.name
  key_name                    = var.ssh_enabled ? var.key_name : null
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  # IMDSv2 only. Hop limit 2 lets the app container (one bridge hop away) use
  # the instance role for KMS and S3.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  # First boot only: writes the deploy config and the deploy script, then runs
  # it. Gzipped to stay under the 16 KB user-data limit.
  user_data_base64 = base64gzip(templatefile("${path.module}/templates/user-data.sh.tftpl", {
    region          = local.region
    config_param    = aws_ssm_parameter.deploy.name
    core_repo       = var.core_repo
    core_ref        = var.core_ref
    deploy_script   = chomp(file("${path.module}/templates/vocion-deploy.sh"))
    caddyfile_alb   = chomp(file("${path.module}/templates/Caddyfile.alb"))
    caddyfile_tls   = chomp(file("${path.module}/templates/Caddyfile.tls"))
    compose_overlay = chomp(file("${path.module}/templates/compose.cloud.yml"))
  }))
  user_data_replace_on_change = false

  tags = { Name = "${var.name_prefix}-app" }

  lifecycle {
    # A newer AMI, or a change to the first-boot script, never replaces a
    # running box. Rebuild deliberately (tofu apply -replace=...).
    ignore_changes = [ami, user_data, user_data_base64]
  }
}

resource "aws_eip" "app" {
  count = var.eip_enabled ? 1 : 0

  domain   = "vpc"
  instance = aws_instance.app.id

  tags = { Name = "${var.name_prefix}-app" }
}

locals {
  app_public_ip = var.eip_enabled ? aws_eip.app[0].public_ip : aws_instance.app.public_ip
}
