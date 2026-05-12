# Vocion AWS deploy — VPC, EC2, EBS, EIP, IAM, user-data.
#
# This file is intentionally one-screen-readable. Route 53 + Secrets
# Manager live in route53.tf / secrets.tf respectively.

# ----- AMI -----

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["137112412989"] # Amazon

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

# ----- VPC + networking -----

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "vocion-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "vocion-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true

  tags = { Name = "vocion-public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "vocion-rt-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# ----- Security group -----

resource "aws_security_group" "app" {
  name        = "vocion-app"
  description = "Vocion EC2 - SSH from operator + HTTPS public"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  ingress {
    description = "HTTP (Caddy + Lets Encrypt HTTP-01 challenge)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "vocion-app-sg" }
}

# ----- IAM (EC2 → Secrets Manager) -----

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
  name               = "vocion-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

data "aws_iam_policy_document" "secrets_read" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = [aws_secretsmanager_secret.production.arn]
  }
}

resource "aws_iam_role_policy" "secrets_read" {
  name   = "vocion-secrets-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.secrets_read.json
}

# Cheap allow for CloudWatch logs (future-use). Keeping the policy
# scoped to a log group we own.
data "aws_iam_policy_document" "logs" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = ["arn:aws:logs:${var.region}:*:log-group:/vocion/*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  name   = "vocion-logs-write"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.logs.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "vocion-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ----- EBS data volume -----

resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_gb
  type              = "gp3"
  encrypted         = true

  tags = { Name = "vocion-data" }

  # Preserve data through `tofu destroy`.
  lifecycle {
    prevent_destroy = true
  }
}

# ----- EC2 instance -----

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.key_name

  root_block_device {
    volume_size           = var.root_volume_gb
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user-data.sh", {
    secret_id = aws_secretsmanager_secret.production.id
    region    = var.region
    git_repo  = var.git_repo
    git_ref   = var.git_ref
  })

  # Re-render user-data if the inputs change. (Instance is NOT
  # replaced — user-data only runs on first boot. The new content is
  # there for re-runs of bootstrap.sh.)
  user_data_replace_on_change = false

  tags = { Name = "vocion-app" }

  lifecycle {
    ignore_changes = [
      # AMI updates shouldn't trigger replacement of the running box;
      # operator handles AMI bumps deliberately via update.sh.
      ami,
    ]
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.app.id
}

resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id

  tags = { Name = "vocion-eip" }
}
