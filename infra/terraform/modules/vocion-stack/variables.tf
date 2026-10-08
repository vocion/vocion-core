# modules/vocion-stack — inputs.
#
# Five are required: name_prefix, azs, hostname, route53_zone_id and core_ref.
# Every other default describes the Cloud profile: an ALB with a WAF in front
# of one EC2 box, RDS PostgreSQL with pgvector, a KMS-backed credential vault,
# AWS Backup with a locked vault, ALB access, WAF and VPC flow logs, Bedrock
# for Anthropic's models, no SSH, no runners.

# ----- identity -----

variable "name_prefix" {
  description = "Prefix for every resource name (IAM roles, security groups, secrets, the RDS identifier, the media bucket). Unique per account, so two installations in one account need two prefixes. Lowercase letters, digits and hyphens."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}[a-z0-9]$", var.name_prefix))
    error_message = "name_prefix must be 3-32 characters of lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "A label for this installation (production, dev, ...). Used in descriptions and the Name tags only; names come from name_prefix."
  type        = string
  default     = "production"
}

# ----- network -----

variable "vpc_cidr" {
  description = "CIDR of the VPC the module creates. Public subnets take /24s from index 1, database subnets from index 11."
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones, at least two (the ALB and the RDS subnet group both need two). The box runs in the first."
  type        = list(string)

  validation {
    condition     = length(var.azs) >= 2
    error_message = "azs needs at least two availability zones."
  }
}

# ----- the app -----

variable "hostname" {
  description = "The hostname the installation serves, e.g. app.example.com. The ACM certificate, the DNS record, the media bucket's CORS origin and NEXT_PUBLIC_APP_URL all follow it."
  type        = string
}

variable "alias_hostnames" {
  description = "Hostnames this installation used to serve elsewhere, each with an ISSUED ACM certificate in this account and region. Browsers are 301'd to `hostname`; `/api/*` (webhooks, API clients) is served in place. Their DNS is not managed here: point each at `alb_dns_name`. Needs alb_enabled."
  type = list(object({
    hostname        = string
    certificate_arn = string
  }))
  default = []

  validation {
    condition     = alltrue([for a in var.alias_hostnames : a.hostname != var.hostname])
    error_message = "An alias hostname cannot be the installation's own hostname."
  }
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone, in this account, that holds `hostname`. The module writes the app record and the certificate's validation records into it; it never creates or deletes the zone."
  type        = string
}

variable "core_repo" {
  description = "Git URL the box clones vocion-core from."
  type        = string
  default     = "https://github.com/vocion/vocion-core.git"

  validation {
    condition     = can(regex("^https://[A-Za-z0-9._~/-]+$", var.core_repo))
    error_message = "core_repo must be an https URL with no quotes or spaces."
  }
}

variable "core_ref" {
  description = "The vocion-core release the box runs: a tag (v5.0.0) or a full 40-character commit sha. Never a branch: a branch is not a pin. Read on first boot; later moves are `sudo vocion-deploy <ref>` on the box."
  type        = string

  validation {
    condition     = can(regex("^(v[0-9]+\\.[0-9]+\\.[0-9]+([-.][0-9A-Za-z.-]+)?|[0-9a-f]{40})$", var.core_ref))
    error_message = "core_ref must be a release tag like v5.0.0 or a full 40-character commit sha."
  }
}

variable "app_env" {
  description = "Non-secret app settings, merged over the app-env secret on every deploy (VOCION_ENFORCE_WORKSPACE_ACCESS, VOCION_MAIL_ENABLED, LANGFUSE_ENABLED, ...). Stored in an SSM String parameter and readable by anyone who can read the account's parameters: never put a credential here."
  type        = map(string)
  default     = {}

  validation {
    condition     = alltrue([for k in keys(var.app_env) : can(regex("^[A-Z_][A-Z0-9_]*$", k))])
    error_message = "app_env keys must be upper-case environment variable names."
  }
}

variable "health_check_path" {
  description = "Path the ALB health check requests. /version.txt is a static file every core image serves."
  type        = string
  default     = "/version.txt"
}

# ----- compute -----

variable "instance_type" {
  description = "EC2 instance type. The box builds the app image itself, which needs about 8 GB of memory on top of the running stack, so 16 GB (r6i.large, t3.xlarge) is the floor."
  type        = string
  default     = "r6i.large"
}

variable "ami_id" {
  description = "AMI for the box. Empty: the newest Amazon Linux 2023 x86_64 at first apply (later AMI releases never replace the box)."
  type        = string
  default     = ""
}

variable "root_volume_gb" {
  description = "Root volume size in GB. Always encrypted. Docker images and build cache live here; the database does not (RDS) and neither does media (S3)."
  type        = number
  default     = 64
}

variable "eip_enabled" {
  description = "Give the box an Elastic IP: a stable egress address, for integrations that allowlist callers."
  type        = bool
  default     = true
}

variable "ssh_enabled" {
  description = "Open port 22 to ssh_cidrs and attach key_name. Off by default: operators reach the box with SSM Session Manager."
  type        = bool
  default     = false
}

variable "ssh_cidrs" {
  description = "CIDRs allowed to SSH when ssh_enabled is true."
  type        = list(string)
  default     = []
}

variable "key_name" {
  description = "Existing EC2 key pair, used only when ssh_enabled is true."
  type        = string
  default     = null
}

# ----- edge -----

variable "alb_enabled" {
  description = "Put an Application Load Balancer with an ACM certificate in front of the box. The box then serves plain HTTP to the ALB only. Off: Caddy on the box terminates TLS with Let's Encrypt and the box takes 80 and 443 from anywhere."
  type        = bool
  default     = true
}

variable "alb_idle_timeout" {
  description = "ALB idle timeout in seconds. Chat answers stream over SSE, so this is the longest a stream may sit silent."
  type        = number
  default     = 300
}

variable "alb_ssl_policy" {
  description = "TLS policy on the ALB's HTTPS listener."
  type        = string
  default     = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "waf_enabled" {
  description = "Attach a WAF web ACL to the ALB: the AWS managed common and known-bad-inputs rule sets, plus a per-IP rate limit. Needs alb_enabled."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Requests per IP per 5 minutes before the WAF blocks that IP."
  type        = number
  default     = 2000
}

variable "waf_body_rules_action" {
  description = "What the common rule set's two body rules, SizeRestrictions_BODY (a body over 8 KB) and CrossSiteScripting_BODY, do: \"count\" (log the match, let the request through) or \"block\". Count by default: chat turns and uploads run past 8 KB, and people paste code and HTML that reads as script. Test the app's large and rich bodies against the WAF log before blocking (README, \"WAF: the body rules\")."
  type        = string
  default     = "count"

  validation {
    condition     = contains(["count", "block"], var.waf_body_rules_action)
    error_message = "waf_body_rules_action must be count or block."
  }
}

variable "waf_count_rules" {
  description = "Further rules of AWSManagedRulesCommonRuleSet to COUNT instead of BLOCK, on top of the body rules when waf_body_rules_action is count. Naming a body rule here keeps that one counting when the other is switched to block."
  type        = list(string)
  default     = []
}

# ----- logging -----

variable "alb_access_logs_enabled" {
  description = "Write the ALB's access logs to a private S3 bucket (SSE-S3, the only encryption ALB log delivery accepts). Needs alb_enabled."
  type        = bool
  default     = true
}

variable "alb_access_logs_bucket_name" {
  description = "Access log bucket name. Empty: <name_prefix>-alb-logs. Bucket names are global, so a taken name needs this."
  type        = string
  default     = ""
}

variable "alb_access_logs_retention_days" {
  description = "Days an access log object is kept before the bucket's lifecycle deletes it."
  type        = number
  default     = 90

  validation {
    condition     = var.alb_access_logs_retention_days >= 1
    error_message = "alb_access_logs_retention_days must be at least 1."
  }
}

variable "waf_logging_enabled" {
  description = "Log every request the WAF evaluates, with the rules it matched, to the CloudWatch Logs group aws-waf-logs-<name_prefix>. Needs waf_enabled."
  type        = bool
  default     = true
}

variable "waf_log_redacted_headers" {
  description = "Request headers WAF writes to its log as REDACTED. Session cookies and bearer tokens never belong in a log."
  type        = list(string)
  default     = ["authorization", "cookie"]
}

variable "waf_log_retention_days" {
  description = "Days the WAF log group keeps events (a value CloudWatch Logs accepts: 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, ...)."
  type        = number
  default     = 90

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.waf_log_retention_days)
    error_message = "waf_log_retention_days must be a retention CloudWatch Logs accepts (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, ...)."
  }
}

variable "flow_logs_enabled" {
  description = "VPC flow logs to the CloudWatch Logs group <name_prefix>-vpc-flow-logs."
  type        = bool
  default     = true
}

variable "flow_logs_traffic_type" {
  description = "What the flow logs record: REJECT (connections the VPC refused: probes, a security group doing its job), ACCEPT or ALL. ALL records every connection the box makes, at many times the volume."
  type        = string
  default     = "REJECT"

  validation {
    condition     = contains(["REJECT", "ACCEPT", "ALL"], var.flow_logs_traffic_type)
    error_message = "flow_logs_traffic_type must be REJECT, ACCEPT or ALL."
  }
}

variable "flow_logs_retention_days" {
  description = "Days the flow log group keeps events (a value CloudWatch Logs accepts)."
  type        = number
  default     = 90

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.flow_logs_retention_days)
    error_message = "flow_logs_retention_days must be a retention CloudWatch Logs accepts (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, ...)."
  }
}

# ----- credential vault -----

variable "kms_vault_enabled" {
  description = "Create a KMS key for the credential vault and set VOCION_CREDENTIAL_VAULT=kms and VOCION_KMS_KEY_ARN for the app. Off: the app falls back to its local vault, which it warns about in production."
  type        = bool
  default     = true
}

# ----- database -----

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_engine_version" {
  description = "PostgreSQL version. A major version alone (16) takes the newest minor and lets RDS move minors in the maintenance window."
  type        = string
  default     = "16"
}

variable "db_multi_az" {
  description = "Run RDS Multi-AZ (a standby in another AZ)."
  type        = bool
  default     = false
}

variable "db_allocated_storage" {
  description = "Initial RDS storage, GB."
  type        = number
  default     = 50
}

variable "db_max_allocated_storage" {
  description = "Ceiling for RDS storage autoscaling, GB."
  type        = number
  default     = 200
}

variable "db_backup_retention_days" {
  description = "RDS automated backups and point-in-time recovery window, days (1-35)."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "RDS deletion protection. Also turns on deletion protection for the ALB."
  type        = bool
  default     = true
}

variable "db_name" {
  description = "The application database RDS creates."
  type        = string
  default     = "vocion"
}

variable "db_master_username" {
  description = "RDS master user. Its password is generated and rotated by RDS in Secrets Manager; the app never uses it."
  type        = string
  default     = "vocion_admin"
}

variable "db_kms_key_arn" {
  description = "Customer-managed KMS key for RDS storage, Performance Insights and the backup vault. Empty: the module creates one."
  type        = string
  default     = ""
}

variable "db_allowed_extensions" {
  description = "rds.allowed_extensions. Core's migrations create `vector`; a migration that needs another extension must be added here first."
  type        = list(string)
  default     = ["plpgsql", "vector", "pg_stat_statements", "pgcrypto", "pg_trgm", "uuid-ossp"]
}

variable "db_backup_window" {
  description = "Daily RDS backup window, UTC."
  type        = string
  default     = "07:00-07:30"
}

variable "db_maintenance_window" {
  description = "Weekly RDS maintenance window, UTC."
  type        = string
  default     = "sun:08:00-sun:08:30"
}

# ----- media -----

variable "media_bucket_name" {
  description = "Media bucket name. Empty: <name_prefix>-media. Bucket names are global, so a taken name needs this."
  type        = string
  default     = ""
}

variable "media_cors_origins" {
  description = "Origins allowed to GET media cross-origin. Empty: https://<hostname>."
  type        = list(string)
  default     = []
}

# ----- secrets -----

variable "secret_recovery_window_days" {
  description = "Days a deleted secret can be restored."
  type        = number
  default     = 30
}

# ----- backup -----

variable "backup_enabled" {
  description = "AWS Backup: a daily RDS backup into this module's vault, locked in governance mode."
  type        = bool
  default     = true
}

variable "backup_schedule" {
  description = "Backup rule schedule (cron, UTC). Keep it clear of db_backup_window and db_maintenance_window: AWS Backup jobs for RDS that overlap either can be skipped."
  type        = string
  default     = "cron(0 3 * * ? *)"
}

variable "backup_retention_days" {
  description = "Days each backup is kept in this vault."
  type        = number
  default     = 35
}

variable "backup_vault_lock_enabled" {
  description = "Lock the vault in governance mode: recovery points cannot be deleted early or kept shorter than the minimum, except by a principal with backup:DeleteBackupVaultLockConfiguration."
  type        = bool
  default     = true
}

variable "backup_vault_lock_min_retention_days" {
  description = "Vault lock minimum retention, days."
  type        = number
  default     = 7
}

variable "backup_vault_lock_max_retention_days" {
  description = "Vault lock maximum retention, days."
  type        = number
  default     = 400
}

variable "backup_copy_vault_arn" {
  description = "A vault in ANOTHER account to copy every backup into. Empty: no copy. Prerequisites outside this module: cross-account backup turned on for the organization (AWS Backup settings, management account), and the destination vault accepting this account (backup_accept_copies_from_account_ids on that side)."
  type        = string
  default     = ""
}

variable "backup_copy_retention_days" {
  description = "Days the cross-account copy is kept."
  type        = number
  default     = 35
}

variable "backup_accept_copies_from_account_ids" {
  description = "Accounts whose backup plans may copy into this module's vault (the receiving side of backup_copy_vault_arn)."
  type        = list(string)
  default     = []
}

# ----- alarms and spend -----

variable "alarm_emails" {
  description = "Emails subscribed to the alarm topic. Each gets a confirmation mail on apply."
  type        = list(string)
  default     = []
}

variable "db_free_storage_alarm_gb" {
  description = "Alarm when RDS free storage stays under this many GB."
  type        = number
  default     = 5
}

variable "budget_monthly_usd" {
  description = "A monthly cost budget for the account, alerting the alarm emails at 80% actual and 100% forecast. 0: none (the organization may already budget this account)."
  type        = number
  default     = 0
}

# ----- engineering runners (off by default) -----

variable "runners_enabled" {
  description = "Create the Fargate engineering runners: an ECS cluster, two task definitions, an SSM parameter the app reads as VOCION_RUNNERS, and an optional fallback poll."
  type        = bool
  default     = false
}

variable "runner_image" {
  description = "Runner image. The package is private on GHCR; the pull credential goes in the <name_prefix>/runner-registry secret."
  type        = string
  default     = "ghcr.io/vocion/vocion-runner:5.x"
}

variable "runner_cpu" {
  description = "Fargate CPU units per runner task (2048 = 2 vCPU)."
  type        = number
  default     = 2048
}

variable "runner_memory" {
  description = "Fargate memory per runner task, MiB."
  type        = number
  default     = 4096
}

variable "runner_max_budget_usd" {
  description = "The most one engineering run may spend on the model; a run's own cap tightens it."
  type        = number
  default     = 12
}

variable "runner_wall_clock_minutes" {
  description = "The longest one engineering run may take; a run's own deadline tightens it."
  type        = number
  default     = 45
}

variable "runner_git_email" {
  description = "Commit author email the runner writes as. Empty: runner@<hostname>."
  type        = string
  default     = ""
}

variable "runner_poll_schedule" {
  description = "EventBridge Scheduler expression for the fallback poll that starts a runner. Empty: no poll (the app's push at dispatch is the only trigger)."
  type        = string
  default     = ""
}

# ----- Amazon Bedrock -----

variable "bedrock_enabled" {
  description = "Let the box's role invoke the models in bedrock_models on Amazon Bedrock, directly and through the account's cross-region inference profiles: bedrock:InvokeModel (also authorizes Converse) and bedrock:InvokeModelWithResponseStream (also ConverseStream). The app uses it when an agent or the installation picks Bedrock (VOCION_LLM_PROVIDER=bedrock). Model access itself is an account setting, outside this module."
  type        = bool
  default     = true
}

variable "bedrock_models" {
  description = "Foundation model ids the box may invoke, as IAM patterns (a trailing * matches every version)."
  type        = list(string)
  default     = ["anthropic.*"]

  validation {
    condition     = length(var.bedrock_models) > 0 && alltrue([for m in var.bedrock_models : can(regex("^[a-z0-9][a-z0-9.:*-]*$", m))])
    error_message = "bedrock_models needs at least one model id pattern, e.g. anthropic.*"
  }
}

variable "bedrock_inference_profile_geography" {
  description = "Geography of the cross-region inference profiles the box may call (us, eu or apac: profile ids us.anthropic.*, ...). The models behind them are allowed in that geography's regions only (us-*, eu-*, ap-*), where those profiles route. Empty: in-region model ids only."
  type        = string
  default     = "us"

  validation {
    condition     = contains(["", "us", "eu", "apac"], var.bedrock_inference_profile_geography)
    error_message = "bedrock_inference_profile_geography must be us, eu, apac or empty."
  }
}

# ----- AgentCore (off by default) -----

variable "agentcore_enabled" {
  description = "Let the box's role create, update and invoke AgentCore harnesses, runtimes and memories in this account and region, and pass the harness execution role. The runtime itself is provisioned by core's infra/agentcore scripts."
  type        = bool
  default     = false
}

variable "agentcore_harness_role_name" {
  description = "Name of the managed-harness execution role the box may pass to AgentCore."
  type        = string
  default     = "VocionAgentCoreHarnessRole"
}
