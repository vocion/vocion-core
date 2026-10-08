# Plans the module in each profile against a mocked AWS provider: no
# credentials, no account, nothing created. Run from the module directory:
#
#   tofu init -backend=false && tofu test

mock_provider "aws" {
  mock_data "aws_region" {
    defaults = { name = "us-east-1" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111111111111" }
  }
  mock_data "aws_partition" {
    defaults = { partition = "aws" }
  }
  mock_data "aws_ec2_instance_type" {
    defaults = { supported_architectures = ["x86_64"] }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }

  # The provider validates ARN-shaped arguments even at plan, so every ARN one
  # resource hands another needs an ARN-shaped mock.
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:us-east-1:111111111111:mock" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:111111111111:key/mock" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:loadbalancer/app/mock/0", arn_suffix = "app/mock/0" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:targetgroup/mock/0", arn_suffix = "targetgroup/mock/0" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:us-east-1:111111111111:listener/app/mock/0/0" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = { arn = "arn:aws:acm:us-east-1:111111111111:certificate/mock" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:111111111111:regional/webacl/mock/0" }
  }
  mock_resource "aws_db_instance" {
    defaults = { arn = "arn:aws:rds:us-east-1:111111111111:db:mock" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111111111111:role/mock" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:us-east-1:111111111111:secret:mock" }
  }
  mock_resource "aws_ssm_parameter" {
    defaults = { arn = "arn:aws:ssm:us-east-1:111111111111:parameter/mock" }
  }
  mock_resource "aws_ecs_cluster" {
    defaults = { arn = "arn:aws:ecs:us-east-1:111111111111:cluster/mock" }
  }
  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn                  = "arn:aws:ecs:us-east-1:111111111111:task-definition/mock:1"
      arn_without_revision = "arn:aws:ecs:us-east-1:111111111111:task-definition/mock"
    }
  }
  mock_resource "aws_backup_vault" {
    defaults = { arn = "arn:aws:backup:us-east-1:111111111111:backup-vault:mock" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111111111111:log-group:aws-waf-logs-mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
}

variables {
  name_prefix     = "vocion-test"
  azs             = ["us-east-1a", "us-east-1b"]
  hostname        = "app.example.com"
  route53_zone_id = "Z0000000000EXAMPLE"
  core_ref        = "v5.0.0"
}

run "cloud_profile_defaults" {
  command = plan

  assert {
    condition     = length(aws_lb.app) == 1 && length(aws_wafv2_web_acl.app) == 1
    error_message = "the Cloud profile puts an ALB with a WAF in front of the box"
  }
  assert {
    condition     = toset(flatten([for r in aws_wafv2_web_acl.app[0].rule : [for st in r.statement : [for g in st.managed_rule_group_statement : [for o in g.rule_action_override : o.name]]] if r.name == "aws-common"])) == toset(["CrossSiteScripting_BODY", "SizeRestrictions_BODY"])
    error_message = "the WAF's two body rules count, not block, by default"
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.app_public) == 0 && length(aws_vpc_security_group_ingress_rule.app_ssh) == 0
    error_message = "behind the ALB the box takes no public ingress and no SSH"
  }
  assert {
    condition     = aws_instance.app.root_block_device[0].encrypted == true
    error_message = "the root volume is always encrypted"
  }
  assert {
    condition     = jsondecode(aws_ssm_parameter.deploy.value).env.VOCION_CREDENTIAL_VAULT == "kms"
    error_message = "the credential vault defaults to KMS"
  }
  assert {
    condition     = length(aws_backup_vault_lock_configuration.main) == 1
    error_message = "backups land in a locked vault by default"
  }
  assert {
    condition     = length(aws_ecs_cluster.runners) == 0
    error_message = "runners are off by default"
  }
  assert {
    condition     = aws_s3_bucket.media.bucket == "vocion-test-media"
    error_message = "the media bucket is named from the prefix"
  }
  assert {
    condition = (
      length(aws_iam_role_policy.bedrock) == 1
      && toset(data.aws_iam_policy_document.bedrock[0].statement[0].actions) == toset(["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"])
      && toset(data.aws_iam_policy_document.bedrock[0].statement[0].resources) == toset(["arn:aws:bedrock:us-*::foundation-model/anthropic.*"])
      && toset(data.aws_iam_policy_document.bedrock[0].statement[1].resources) == toset(["arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.anthropic.*"])
    )
    error_message = "the box may invoke Anthropic models on Bedrock: in-region, and through this account's us.* profiles to the US regions they route to"
  }
  assert {
    condition     = aws_s3_bucket.alb_logs[0].bucket == "vocion-test-alb-logs"
    error_message = "the access log bucket is named from the prefix"
  }
  assert {
    condition     = aws_lb.app[0].access_logs[0].enabled && aws_lb.app[0].access_logs[0].prefix == "alb"
    error_message = "the ALB writes its access logs under alb/"
  }
  assert {
    condition     = one([for r in aws_s3_bucket_server_side_encryption_configuration.alb_logs[0].rule : one(r.apply_server_side_encryption_by_default).sse_algorithm]) == "AES256"
    error_message = "the access log bucket is SSE-S3, the only encryption ALB log delivery accepts"
  }
  assert {
    condition     = one([for r in aws_s3_bucket_lifecycle_configuration.alb_logs[0].rule : one(r.expiration).days]) == 90
    error_message = "access logs expire after 90 days"
  }
  assert {
    condition = (
      aws_cloudwatch_log_group.waf[0].name == "aws-waf-logs-vocion-test"
      && toset([for f in aws_wafv2_web_acl_logging_configuration.app[0].redacted_fields : f.single_header[0].name]) == toset(["authorization", "cookie"])
    )
    error_message = "the WAF logs to aws-waf-logs-<prefix> with Authorization and Cookie redacted"
  }
  assert {
    condition     = aws_flow_log.vpc[0].traffic_type == "REJECT" && aws_cloudwatch_log_group.flow[0].retention_in_days == 90
    error_message = "the VPC's rejected connections are logged for 90 days"
  }
}

run "single_box_with_ssh" {
  command = plan

  variables {
    alb_enabled       = false
    ssh_enabled       = true
    ssh_cidrs         = ["203.0.113.0/24"]
    key_name          = "operator"
    kms_vault_enabled = false
    backup_enabled    = false
    eip_enabled       = false
    bedrock_enabled   = false
  }

  assert {
    condition     = length(aws_lb.app) == 0 && length(aws_wafv2_web_acl.app) == 0 && length(aws_route53_record.app_direct) == 1
    error_message = "without the ALB the record points at the box"
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.app_public) == 2 && length(aws_vpc_security_group_ingress_rule.app_ssh) == 1
    error_message = "without the ALB the box takes 80/443, and SSH when asked"
  }
  assert {
    condition     = !contains(keys(jsondecode(aws_ssm_parameter.deploy.value).env), "VOCION_KMS_KEY_ARN")
    error_message = "no KMS key, no VOCION_KMS_KEY_ARN"
  }
  assert {
    condition     = length(aws_iam_role_policy.bedrock) == 0
    error_message = "bedrock_enabled = false grants no Bedrock access"
  }
  assert {
    condition     = length(aws_s3_bucket.alb_logs) == 0 && length(aws_wafv2_web_acl_logging_configuration.app) == 0 && length(aws_flow_log.vpc) == 1
    error_message = "without the ALB there are no ALB or WAF logs; the flow logs stay"
  }
}

run "everything_on" {
  command = plan

  variables {
    runners_enabled                       = true
    runner_poll_schedule                  = "rate(1 minute)"
    agentcore_enabled                     = true
    budget_monthly_usd                    = 500
    alarm_emails                          = ["ops@example.com"]
    backup_copy_vault_arn                 = "arn:aws:backup:us-east-1:222222222222:backup-vault:vocion-receive"
    backup_accept_copies_from_account_ids = ["222222222222"]
    db_multi_az                           = true
    db_backup_retention_days              = 14
    app_env                               = { VOCION_MAIL_ENABLED = "0" }
  }

  assert {
    condition     = length(aws_ecs_task_definition.runner_db) == 1 && length(aws_scheduler_schedule.runner_poll) == 1
    error_message = "runners and their poll come up when asked"
  }
  assert {
    condition     = aws_db_instance.main.multi_az && aws_db_instance.main.backup_retention_period == 14
    error_message = "Multi-AZ and the PITR window follow the inputs"
  }
  assert {
    condition     = jsondecode(aws_ssm_parameter.deploy.value).env.VOCION_MAIL_ENABLED == "0"
    error_message = "app_env reaches the box's deploy config"
  }
  assert {
    condition     = length(aws_backup_vault_policy.main) == 1
    error_message = "the vault accepts copies from the named accounts"
  }
}

run "logging_off" {
  command = plan

  variables {
    alb_access_logs_enabled = false
    waf_logging_enabled     = false
    flow_logs_enabled       = false
  }

  assert {
    condition = (
      length(aws_s3_bucket.alb_logs) == 0 && length(aws_lb.app[0].access_logs) == 0
      && length(aws_wafv2_web_acl_logging_configuration.app) == 0 && length(aws_cloudwatch_log_group.waf) == 0
      && length(aws_flow_log.vpc) == 0 && length(aws_iam_role.flow_logs) == 0
    )
    error_message = "each log turns off on its own variable"
  }
}

run "waf_body_rules_block" {
  command = plan

  variables {
    waf_body_rules_action = "block"
  }

  assert {
    condition     = length(toset(flatten([for r in aws_wafv2_web_acl.app[0].rule : [for st in r.statement : [for g in st.managed_rule_group_statement : [for o in g.rule_action_override : o.name]]] if r.name == "aws-common"]))) == 0
    error_message = "waf_body_rules_action = block leaves no rule counting"
  }
}

run "waf_one_body_rule_counts" {
  command = plan

  variables {
    waf_body_rules_action = "block"
    waf_count_rules       = ["SizeRestrictions_BODY"]
  }

  assert {
    condition     = toset(flatten([for r in aws_wafv2_web_acl.app[0].rule : [for st in r.statement : [for g in st.managed_rule_group_statement : [for o in g.rule_action_override : o.name]]] if r.name == "aws-common"])) == toset(["SizeRestrictions_BODY"])
    error_message = "a body rule named in waf_count_rules keeps counting when the other blocks"
  }
}

run "rejects_a_retention_cloudwatch_does_not_accept" {
  command = plan

  variables {
    waf_log_retention_days = 10
  }

  expect_failures = [var.waf_log_retention_days]
}

run "rejects_a_branch_as_core_ref" {
  command = plan

  variables {
    core_ref = "main"
  }

  expect_failures = [var.core_ref]
}
