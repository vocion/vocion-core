# modules/vocion-stack — what the edge and the network record.
#
#   ALB access logs   every request the ALB answered, to a private S3 bucket
#                     that keeps them alb_access_logs_retention_days
#   WAF logs          every request the web ACL evaluated, and which rules
#                     matched, to CloudWatch Logs, with the Authorization and
#                     Cookie headers redacted
#   VPC flow logs     connections the VPC refused (REJECT; ALL on request),
#                     to CloudWatch Logs
#
# Each is on by default and has its own retention. The box's role can write
# only log groups under /<name_prefix>/ (compute.tf), so it can write none of
# these.

locals {
  alb_access_logs_enabled = var.alb_enabled && var.alb_access_logs_enabled
  waf_logging_enabled     = local.waf_enabled && var.waf_logging_enabled

  alb_access_logs_bucket = var.alb_access_logs_bucket_name != "" ? var.alb_access_logs_bucket_name : "${var.name_prefix}-alb-logs"
  alb_access_logs_prefix = "alb"
}

# ----- ALB access logs -----
#
# Elastic Load Balancing writes access logs only to a bucket encrypted with
# S3-managed keys (SSE-S3); a KMS key is refused. The bucket is otherwise as
# closed as the media bucket: owner-enforced, no public access, TLS only.

resource "aws_s3_bucket" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket = local.alb_access_logs_bucket

  tags = { Name = local.alb_access_logs_bucket }
}

resource "aws_s3_bucket_ownership_controls" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket                  = aws_s3_bucket.alb_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    id     = "expire"
    status = "Enabled"

    filter {}

    expiration {
      days = var.alb_access_logs_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  # The log delivery service, for load balancers in this account and region
  # only, under this account's prefix only.
  statement {
    sid       = "ElbLogDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs[0].arn}/${local.alb_access_logs_prefix}/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:elasticloadbalancing:${local.region}:${local.account_id}:loadbalancer/*"]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.alb_logs[0].arn, "${aws_s3_bucket.alb_logs[0].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  count = local.alb_access_logs_enabled ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id
  policy = data.aws_iam_policy_document.alb_logs[0].json

  depends_on = [aws_s3_bucket_public_access_block.alb_logs]
}

# ----- WAF logs -----
#
# The log group name must start with aws-waf-logs-. On the first
# PutLoggingConfiguration, WAF adds the log group to the account's CloudWatch
# Logs resource policy for log delivery itself.

resource "aws_cloudwatch_log_group" "waf" {
  count = local.waf_logging_enabled ? 1 : 0

  name              = "aws-waf-logs-${var.name_prefix}"
  retention_in_days = var.waf_log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "app" {
  count = local.waf_logging_enabled ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.app[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]

  # Session cookies and bearer tokens never reach the log.
  dynamic "redacted_fields" {
    for_each = toset([for h in var.waf_log_redacted_headers : lower(h)])
    content {
      single_header {
        name = redacted_fields.value
      }
    }
  }
}

# ----- VPC flow logs -----

resource "aws_cloudwatch_log_group" "flow" {
  count = var.flow_logs_enabled ? 1 : 0

  name              = "${var.name_prefix}-vpc-flow-logs"
  retention_in_days = var.flow_logs_retention_days
}

data "aws_iam_policy_document" "flow_logs_assume" {
  count = var.flow_logs_enabled ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:ec2:${local.region}:${local.account_id}:vpc-flow-log/*"]
    }
  }
}

resource "aws_iam_role" "flow_logs" {
  count = var.flow_logs_enabled ? 1 : 0

  name               = "${var.name_prefix}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume[0].json
}

data "aws_iam_policy_document" "flow_logs_write" {
  count = var.flow_logs_enabled ? 1 : 0

  statement {
    sid       = "WriteFlowLogGroup"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = [aws_cloudwatch_log_group.flow[0].arn, "${aws_cloudwatch_log_group.flow[0].arn}:*"]
  }
  # A list call, authorized against the account's log groups as a whole.
  statement {
    sid       = "FindLogGroup"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:*"]
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.flow_logs_enabled ? 1 : 0

  name   = "${var.name_prefix}-vpc-flow-logs"
  role   = aws_iam_role.flow_logs[0].id
  policy = data.aws_iam_policy_document.flow_logs_write[0].json
}

resource "aws_flow_log" "vpc" {
  count = var.flow_logs_enabled ? 1 : 0

  vpc_id                   = aws_vpc.main.id
  traffic_type             = var.flow_logs_traffic_type
  log_destination_type     = "cloud-watch-logs"
  log_destination          = aws_cloudwatch_log_group.flow[0].arn
  iam_role_arn             = aws_iam_role.flow_logs[0].arn
  max_aggregation_interval = 600

  tags = { Name = "${var.name_prefix}-vpc-flow-logs" }
}
