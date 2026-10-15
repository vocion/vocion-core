# modules/vocion-stack — shared values and the network.
#
# One installation: a VPC with public subnets (the ALB and the box) and
# private database subnets (RDS, no route out), across var.azs.
#
# The box sits in a public subnet with a public address for its own egress
# (git, the model APIs, image pulls) instead of behind a NAT gateway. What
# makes it private is its security group: with the ALB on, the only thing that
# can open a connection to it is the ALB, on port 80. Operators come in over
# SSM Session Manager, which needs no inbound port at all.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  region     = data.aws_region.current.name
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  app_url = "https://${var.hostname}"

  waf_enabled    = var.alb_enabled && var.waf_enabled
  create_db_key  = var.db_kms_key_arn == ""
  db_kms_key_arn = local.create_db_key ? aws_kms_key.data[0].arn : var.db_kms_key_arn

  media_bucket_name  = var.media_bucket_name != "" ? var.media_bucket_name : "${var.name_prefix}-media"
  media_cors_origins = length(var.media_cors_origins) > 0 ? var.media_cors_origins : [local.app_url]

  # The box runs in the first AZ; the ALB and RDS span all of them.
  box_az = var.azs[0]

  # SSM parameter names the box reads on every deploy (templates/vocion-deploy.sh).
  deploy_param  = "/${var.name_prefix}/deploy"
  runners_param = "/${var.name_prefix}/runners"
}

# ----- VPC -----

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name_prefix}-igw" }
}

resource "aws_subnet" "public" {
  count = length(var.azs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "${var.name_prefix}-public-${var.azs[count.index]}", Tier = "public" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.name_prefix}-rt-public" }
}

resource "aws_route_table_association" "public" {
  count = length(var.azs)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Database subnets use the VPC's main route table, which is local-only: no
# route to the internet gateway in either direction.
resource "aws_subnet" "db" {
  count = length(var.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone = var.azs[count.index]

  tags = { Name = "${var.name_prefix}-db-${var.azs[count.index]}", Tier = "private" }
}

# The default security group admits all traffic between its members. Nothing
# here uses it; emptying it means nothing that lands in it by accident can talk.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name_prefix}-default-unused" }
}
