# modules/vocion-stack — outputs.

output "url" {
  description = "The installation's URL."
  value       = local.app_url
}

output "hostname" {
  description = "The hostname served."
  value       = var.hostname
}

output "vpc_id" {
  description = "The installation's VPC."
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnets (ALB, box, runners)."
  value       = aws_subnet.public[*].id
}

output "db_subnet_ids" {
  description = "Private database subnets."
  value       = aws_subnet.db[*].id
}

output "instance_id" {
  description = "The box. Reach it with `aws ssm start-session --target <id>`."
  value       = aws_instance.app.id
}

output "public_ip" {
  description = "The box's egress address (the Elastic IP when eip_enabled). With the ALB on, nothing outside the VPC can connect to it."
  value       = local.app_public_ip
}

output "app_security_group_id" {
  description = "The box's security group."
  value       = aws_security_group.app.id
}

output "instance_role_name" {
  description = "The box's IAM role, for attaching further policies from the calling root."
  value       = aws_iam_role.ec2.name
}

output "alb_dns_name" {
  description = "The ALB's DNS name (null with alb_enabled = false)."
  value       = var.alb_enabled ? aws_lb.app[0].dns_name : null
}

output "alb_arn" {
  description = "The ALB (null with alb_enabled = false)."
  value       = var.alb_enabled ? aws_lb.app[0].arn : null
}

output "waf_web_acl_arn" {
  description = "The WAF web ACL on the ALB (null when off)."
  value       = local.waf_enabled ? aws_wafv2_web_acl.app[0].arn : null
}

output "alb_access_logs_bucket" {
  description = "The bucket holding the ALB's access logs, under alb/AWSLogs/<account>/ (null when off)."
  value       = local.alb_access_logs_enabled ? aws_s3_bucket.alb_logs[0].bucket : null
}

output "waf_log_group_name" {
  description = "CloudWatch Logs group of the WAF's request log (null when off)."
  value       = local.waf_logging_enabled ? aws_cloudwatch_log_group.waf[0].name : null
}

output "flow_log_group_name" {
  description = "CloudWatch Logs group of the VPC flow logs (null when off)."
  value       = var.flow_logs_enabled ? aws_cloudwatch_log_group.flow[0].name : null
}

output "certificate_arn" {
  description = "The ACM certificate for hostname (null with alb_enabled = false)."
  value       = var.alb_enabled ? aws_acm_certificate.app[0].arn : null
}

output "certificate_validation_records" {
  description = "The ACM certificate's DNS validation records ({name, type, value}). Added by the module when route53_zone_id is set; otherwise add them wherever the hostname's DNS lives."
  value = var.alb_enabled ? [
    for o in aws_acm_certificate.app[0].domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ] : []
}

output "app_env_secret_name" {
  description = "Secret holding the app's secret env (JSON). Put its value out-of-band."
  value       = aws_secretsmanager_secret.app_env.name
}

output "app_env_secret_arn" {
  description = "ARN of the app-env secret."
  value       = aws_secretsmanager_secret.app_env.arn
}

output "rds_app_secret_name" {
  description = "Secret holding the app's database login ({\"username\",\"password\"}). Put its value out-of-band."
  value       = aws_secretsmanager_secret.rds_app.name
}

output "extension_deploy_key_secret_name" {
  description = "Secret holding the private half of the extension's read-only deploy key. Put its value out-of-band (null without extension_repo)."
  value       = local.extension_enabled ? aws_secretsmanager_secret.extension_deploy_key[0].name : null
}

output "deploy_config_parameter" {
  description = "SSM parameter the box reads on every deploy (names and non-secret env)."
  value       = aws_ssm_parameter.deploy.name
}

output "db_endpoint" {
  description = "RDS endpoint (host:port). Private: reachable from the box only."
  value       = aws_db_instance.main.endpoint
}

output "db_address" {
  description = "RDS hostname."
  value       = aws_db_instance.main.address
}

output "db_identifier" {
  description = "RDS instance identifier."
  value       = aws_db_instance.main.identifier
}

output "db_master_secret_arn" {
  description = "The RDS-managed master user secret (rotated by RDS; operators only, never the app)."
  value       = one(aws_db_instance.main.master_user_secret[*].secret_arn)
}

output "data_kms_key_arn" {
  description = "KMS key for RDS, Performance Insights and backups."
  value       = local.db_kms_key_arn
}

output "credential_vault_kms_key_arn" {
  description = "KMS key behind VOCION_KMS_KEY_ARN (null with kms_vault_enabled = false)."
  value       = var.kms_vault_enabled ? aws_kms_key.vault[0].arn : null
}

output "media_bucket" {
  description = "The media bucket (VOCION_MEDIA_BUCKET)."
  value       = aws_s3_bucket.media.bucket
}

output "backup_vault_arn" {
  description = "The AWS Backup vault (null with backup_enabled = false). Hand it to another installation's backup_copy_vault_arn to receive its copies."
  value       = var.backup_enabled ? aws_backup_vault.main[0].arn : null
}

output "alarm_topic_arn" {
  description = "SNS topic every alarm notifies."
  value       = aws_sns_topic.alarms.arn
}

output "runner_cluster" {
  description = "ECS cluster the engineering runners run in (null when off)."
  value       = var.runners_enabled ? aws_ecs_cluster.runners[0].name : null
}

output "runner_secret_name" {
  description = "The runners' secret (VOCION_RUNNER_TOKEN, ANTHROPIC_API_KEY, GITHUB_TOKEN; null when off)."
  value       = var.runners_enabled ? aws_secretsmanager_secret.runner[0].name : null
}

output "session_command" {
  description = "Open a shell on the box."
  value       = "aws ssm start-session --region ${local.region} --target ${aws_instance.app.id}"
}

output "deploy_document_name" {
  description = "The SSM document that writes the module's current box files and deploys. Every deploy goes through it, so a change to the module's templates reaches the box."
  value       = aws_ssm_document.deploy.name
}

output "deploy_command" {
  description = "Deploy a release, from an operator machine. The output is the deploy's tail; the full log is /var/log/vocion-deploy-last.log on the box."
  value       = "aws ssm send-command --region ${local.region} --instance-ids ${aws_instance.app.id} --document-name ${aws_ssm_document.deploy.name} --parameters ref=<tag or full sha>"
}
