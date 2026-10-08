# modules/vocion-stack

One Vocion installation on AWS, as one OpenTofu module call.

```hcl
module "vocion" {
  source = "../vocion-core/infra/terraform/modules/vocion-stack"

  name_prefix     = "acme-vocion"
  azs             = ["us-east-1a", "us-east-1b"]
  hostname        = "agents.acme.example"
  route53_zone_id = aws_route53_zone.agents.zone_id
  core_ref        = "v5.0.0"
}
```

Region, account and credentials come from the `aws` provider the calling root
configures; the module configures none. A parent project that pins
`vocion-core` as a submodule points `source` into it, so the infrastructure and
the application move together on one pin. A working root is in
[`examples/minimal`](./examples/minimal).

---

## What it builds

| | Default (the Cloud profile) | Switch |
|---|---|---|
| Network | VPC, public subnets in every AZ (ALB, box), private DB subnets (no route out) | `vpc_cidr`, `azs` |
| Edge | ALB, ACM certificate (DNS-validated in your zone), HTTP → HTTPS, only `hostname` forwarded | `alb_enabled` |
| WAF | AWS common + known-bad-inputs rule sets, per-IP rate limit | `waf_enabled`, `waf_rate_limit`, `waf_count_rules` |
| Box | One EC2 (Amazon Linux 2023), encrypted root, IMDSv2, Elastic IP for egress; reachable only from the ALB | `instance_type`, `root_volume_gb`, `eip_enabled` |
| Access | SSM Session Manager. No port 22 | `ssh_enabled`, `ssh_cidrs`, `key_name` |
| Database | RDS PostgreSQL 16, pgvector allowed, TLS forced, CMK-encrypted, PITR, deletion protection | `db_*` |
| Credential vault | A KMS key; the app runs `VOCION_CREDENTIAL_VAULT=kms` | `kms_vault_enabled` |
| Media | Private S3 bucket, versioned, TLS-only, CORS for `hostname` | `media_bucket_name`, `media_cors_origins` |
| Secrets | Two Secrets Manager entries, **names only** (values are put out-of-band) | `secret_recovery_window_days` |
| Backup | AWS Backup: daily RDS backup into a vault locked in governance mode; optional cross-account copy | `backup_*` |
| Logs | ALB access logs to a private S3 bucket (SSE-S3); the WAF's request log to CloudWatch Logs, `Authorization` and `Cookie` redacted; VPC flow logs of refused connections. 90 days each | `alb_access_logs_*`, `waf_logging_enabled`, `waf_log_*`, `flow_logs_*` |
| Alarms | SNS topic; box CPU and status checks (system failures auto-recover), site down, 5xx, RDS CPU and free storage | `alarm_emails` |
| Budget | none | `budget_monthly_usd` |
| Bedrock | The box's role may invoke Anthropic models: in-region, and through this account's `us.` inference profiles in the US regions they route to (`InvokeModel`, `InvokeModelWithResponseStream`; they also authorize Converse and ConverseStream) | `bedrock_enabled`, `bedrock_models`, `bedrock_inference_profile_geography` |
| Engineering runners | none | `runners_enabled`, `runner_*` |
| AgentCore IAM | none | `agentcore_enabled` |

With `alb_enabled = false` it is the classic single box: the record points at
the box and Caddy terminates TLS with Let's Encrypt. Everything else is the
same.

What it deliberately does **not** do:

- **Create or delegate the hosted zone.** It writes two kinds of record into
  `route53_zone_id` (the app and the certificate validation), nothing else.
- **Put any secret value.** No `aws_secretsmanager_secret_version` exists, so
  no credential is ever in state, tfvars or a plan.
- **Self-host Langfuse.** Use Langfuse Cloud (set `LANGFUSE_*` in the secret)
  or turn it off (`LANGFUSE_ENABLED=false`).
- **Deploy the AgentCore runtime.** That is `infra/agentcore/*.sh`, the second
  deploy described in [the parent-project pattern](../../../../docs/deployment/parent-project-pattern.md).
- **Turn on cross-account backup for the organization.** See [Backup](#backup).

---

## The box contract

`tofu apply` creates a box that deploys itself. Nothing is built into the AMI.

### First boot (user-data)

User-data runs once and writes four things, then runs the first deploy:

| On the box | What |
|---|---|
| `/etc/vocion/deploy.env` | region, the module's SSM parameter name, `core_repo`, `core_ref` |
| `/usr/local/sbin/vocion-deploy` | the deploy, [`templates/vocion-deploy.sh`](./templates/vocion-deploy.sh) |
| `/etc/vocion/Caddyfile.alb`, `Caddyfile.tls` | Caddy behind the ALB (plain HTTP on :80), or terminating TLS |
| `/etc/vocion/compose.cloud.yml` | the module's overlay on core's compose files |

If the first deploy cannot finish (usually: the secrets have no values yet) the
boot still succeeds; the box waits, reachable over SSM, for `sudo vocion-deploy`.
Its log is `/var/log/cloud-init-output.log`.

### Every deploy: `sudo vocion-deploy [<ref>]`

From a session (`tofu output -raw session_command`):

```bash
sudo vocion-deploy            # redeploy the release in /etc/vocion/deploy.env
sudo vocion-deploy v5.1.0     # move to another release: a tag, or a full 40-char sha
```

A branch name is refused: a branch is not a pin. In order:

1. **Packages.** Docker, the compose plugin, git, jq (and core's buildx installer before a build).
2. **Config.** Reads the SSM parameter `/<name_prefix>/deploy` (`deploy_config_parameter`):
   hostname, ALB mode, secret ids, the RDS endpoint, and the module's env. Read on every
   deploy, so an apply that changes any of these reaches the box on its next deploy, with
   no rebuild.
3. **Checkout.** `vocion-core` at the release into `/opt/vocion`, detached.
4. **Env.** Builds `.env.production` (mode 0600), lowest precedence first:
   1. the `<name_prefix>/app-env` secret (JSON object);
   2. the module's env, then `app_env` over it;
   3. `VOCION_RUNNERS` and `VOCION_RUNNER_TOKEN`, when runners are on;
   4. `DATABASE_URL`, built from the `<name_prefix>/rds-app` secret, the RDS endpoint and
      `sslmode=verify-full` against Amazon's RDS CA bundle. A `DATABASE_URL` in the
      app-env secret is ignored, with a warning.

   Keep each key in one place. A value that would be misread by compose's dotenv
   parser (`$`, ` #`, surrounding whitespace) is written single-quoted.
5. **Image.** Built on the box from the checkout, with `NEXT_PUBLIC_APP_URL` and the build
   stamp (`/version.txt`). `sudo VOCION_APP_IMAGE=<ref> vocion-deploy` pulls a prebuilt
   image instead, through core's `pull-app-image.sh`.
6. **Migrate.** Core's `infra/aws/apply-migrations.sh`, unchanged, against RDS: it runs
   psql by `docker exec`, so the deploy points it at a throwaway client container whose
   libpq environment names RDS (TLS verified). Runs **before** the swap, so new code never
   serves an old schema; a failed migration stops the deploy with the old container up.
7. **Swap.** `docker compose up` with core's four files and the overlay:
   `docker-compose.yml`, `infra/docker-compose.platform.yml`,
   `infra/aws/docker-compose.prod.yml`, `infra/docker-compose.langfuse.prod.yml`,
   `/etc/vocion/compose.cloud.yml`. The overlay switches off core's local postgres
   (the database is RDS) and the platform stack, so what runs is `app` and `caddy`;
   compose neither pulls nor starts the rest. The network core's prod overlay joins,
   `vocion_default`, is created directly on a fresh box.
8. **Check.** The new container must report the commit that was built in its
   `/version.txt` (`deploy-pin`), and, behind the ALB, Caddy must serve it on :80.
   Otherwise the deploy fails, loudly.

Rolling back is `sudo vocion-deploy <previous tag>`. Migrations only move forward,
so a rollback across a migration runs the old code on the new schema; core's
migration conventions (expand, then contract) are what make that safe.

### What the module sets for the app

| Variable | Value |
|---|---|
| `VOCION_HOSTNAME`, `NEXT_PUBLIC_APP_URL`, `AUTH_URL` | `hostname`, `https://<hostname>` |
| `AWS_REGION` | the provider's region |
| `VOCION_MEDIA_BUCKET`, `VOCION_MEDIA_REGION` | the media bucket |
| `VOCION_CREDENTIAL_VAULT`, `VOCION_KMS_KEY_ARN` | `kms` and the vault key (with `kms_vault_enabled`) |
| `VOCION_ARTIFACTS_DIR` | `/var/lib/vocion/artifacts`, a host directory, so artifacts outlive the container |
| `LANGFUSE_SELF_HOSTED_REPLICAS` | `0` |
| `VOCION_TRUSTED_PROXIES` | `vpc_cidr`, the only source Caddy trusts `X-Forwarded-*` from |
| `DATABASE_URL` | built at deploy time (above) |

Everything else is yours: secret values in the app-env secret, non-secret
settings in `app_env`. `app_env` lands in an SSM String parameter, readable by
anyone who can read the account's parameters: never put a credential in it.

---

## First deploy

```bash
tofu apply
```

The box boots, finds empty secrets and waits. Then:

**1. The app's secret env.** At minimum a fresh `AUTH_SECRET` and a separate
`VOCION_TOOL_SIGNING_SECRET` (`openssl rand -base64 32` each), and the model
keys the installation uses:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(tofu output -raw app_env_secret_name)" \
  --secret-string file://app-env.json      # {"AUTH_SECRET": "...", ...}
```

**2. The app's database login.** The master user (RDS-managed, rotated) is for
this step only; the box can never read it. From your machine, through the box,
with an SSM port forward:

```bash
aws ssm start-session --target "$(tofu output -raw instance_id)" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=$(tofu output -raw db_address),portNumber=5432,localPortNumber=15432"

# in another terminal
export PGPASSWORD="$(aws secretsmanager get-secret-value \
  --secret-id "$(tofu output -raw db_master_secret_arn)" \
  --query SecretString --output text | jq -r .password)"
psql "host=localhost port=15432 dbname=vocion user=vocion_admin sslmode=require"
```

```sql
CREATE EXTENSION IF NOT EXISTS vector;           -- needs rds_superuser, so here, once
CREATE ROLE vocion_app LOGIN PASSWORD '<generated>';
ALTER DATABASE vocion OWNER TO vocion_app;       -- owns the public schema too (PG 15+)
```

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(tofu output -raw rds_app_secret_name)" \
  --secret-string '{"username":"vocion_app","password":"<generated>"}'
```

**3. Deploy.** From a session: `sudo vocion-deploy`. The first image build
takes a while; the deploy ends by naming the commit the app serves.

The installation is now up and **closed**: an empty database, no tenants and
no users. Creating the first operator account is the next, separate step.

---

## Backup

Two layers:

- **RDS automated backups**: point-in-time recovery for `db_backup_retention_days`.
- **AWS Backup**: a daily backup into this module's vault, encrypted under the data
  key, kept `backup_retention_days`. The vault is locked in **governance** mode, so no
  recovery point can be deleted early except by a principal holding
  `backup:DeleteBackupVaultLockConfiguration`. Compliance mode (irreversible) is a
  one-line change once the numbers have settled.

**Cross-account copy** (`backup_copy_vault_arn`) sends each backup to a vault in
another account. It needs, outside this module:

1. Cross-account backup turned on for the organization: AWS Backup → Settings in the
   **management** account.
2. The destination vault accepting this account. If the destination is another
   installation of this module, set `backup_accept_copies_from_account_ids = ["<this account>"]`
   on that call and pass its `backup_vault_arn` output here.
3. The data key readable by the destination account. The module adds that grant to the
   key it creates; a key you pass in `db_kms_key_arn` needs it added by you.

Until all three exist, leave `backup_copy_vault_arn` empty.

---

## Logs

| Log | Where | Kept |
|---|---|---|
| ALB access logs | S3 `<name_prefix>-alb-logs` (`alb_access_logs_bucket`), under `alb/AWSLogs/<account>/elasticloadbalancing/<region>/` | `alb_access_logs_retention_days` (90), then the bucket's lifecycle deletes them |
| WAF request log | CloudWatch Logs `aws-waf-logs-<name_prefix>` (`waf_log_group_name`): each request the web ACL evaluated, its action, and the rules that matched or counted. `Authorization` and `Cookie` are written as `REDACTED` (`waf_log_redacted_headers`) | `waf_log_retention_days` (90) |
| VPC flow logs | CloudWatch Logs `<name_prefix>-vpc-flow-logs` (`flow_log_group_name`): connections the VPC refused (`flow_logs_traffic_type = "REJECT"`) | `flow_logs_retention_days` (90) |

The access log bucket uses S3-managed keys because ALB log delivery accepts no
other encryption; it is otherwise as closed as the media bucket (owner-enforced,
no public access, TLS only), and only load balancers in this account and region
may write to it. The log groups are encrypted at rest by CloudWatch Logs. The
box's role can write only log groups under `/<name_prefix>/`, so it can write
none of these.

What the WAF blocked, by web ACL rule and path (CloudWatch Logs Insights, on
the `aws-waf-logs-<name_prefix>` group):

```
fields @timestamp, terminatingRuleId, httpRequest.uri
| filter action = "BLOCK"
| stats count(*) as requests by terminatingRuleId, httpRequest.uri
| sort requests desc
```

A block by a managed rule shows the web ACL rule (`aws-common`) as
`terminatingRuleId`; the managed rule that fired is in
`ruleGroupList.*.terminatingRule.ruleId`. A managed rule set to COUNT never
terminates: it appears in `ruleGroupList.*.nonTerminatingMatchingRules`.

---

## Inputs

Required: `name_prefix`, `azs`, `hostname`, `route53_zone_id`, `core_ref`.

| Name | Type | Default | Description |
|---|---|---|---|
| `name_prefix` | string | | Prefix for every resource name; unique per account |
| `environment` | string | `"production"` | Label for descriptions and tags |
| `vpc_cidr` | string | `"10.0.0.0/16"` | VPC CIDR |
| `azs` | list(string) | | At least two AZs; the box runs in the first |
| `hostname` | string | | Hostname served |
| `route53_zone_id` | string | | In-account zone holding `hostname` |
| `core_repo` | string | `"https://github.com/vocion/vocion-core.git"` | Repo the box clones |
| `core_ref` | string | | Release tag (`v5.0.0`) or full sha. Never a branch |
| `app_env` | map(string) | `{}` | Non-secret app settings merged over the secret |
| `health_check_path` | string | `"/version.txt"` | ALB health check path |
| `instance_type` | string | `"r6i.large"` | 16 GB is the floor: the box builds its image |
| `ami_id` | string | `""` | Empty: newest Amazon Linux 2023 at first apply |
| `root_volume_gb` | number | `64` | Encrypted root volume size |
| `eip_enabled` | bool | `true` | Stable egress address |
| `ssh_enabled` | bool | `false` | Open 22 to `ssh_cidrs` |
| `ssh_cidrs` | list(string) | `[]` | |
| `key_name` | string | `null` | Used only with `ssh_enabled` |
| `alb_enabled` | bool | `true` | ALB + ACM in front of the box |
| `alb_idle_timeout` | number | `300` | Longest silence on an SSE stream, seconds |
| `alb_ssl_policy` | string | `"ELBSecurityPolicy-TLS13-1-2-2021-06"` | |
| `waf_enabled` | bool | `true` | Needs `alb_enabled` |
| `waf_rate_limit` | number | `2000` | Requests per IP per 5 minutes |
| `waf_count_rules` | list(string) | `["SizeRestrictions_BODY", "CrossSiteScripting_BODY"]` | Common-rule-set rules counted, not blocked (chat bodies are large and contain code) |
| `alb_access_logs_enabled` | bool | `true` | ALB access logs to S3. Needs `alb_enabled` |
| `alb_access_logs_bucket_name` | string | `""` | Empty: `<name_prefix>-alb-logs` |
| `alb_access_logs_retention_days` | number | `90` | |
| `waf_logging_enabled` | bool | `true` | WAF request log to CloudWatch Logs. Needs `waf_enabled` |
| `waf_log_redacted_headers` | list(string) | `["authorization", "cookie"]` | Written as `REDACTED` |
| `waf_log_retention_days` | number | `90` | A CloudWatch Logs retention value |
| `flow_logs_enabled` | bool | `true` | VPC flow logs to CloudWatch Logs |
| `flow_logs_traffic_type` | string | `"REJECT"` | `REJECT`, `ACCEPT` or `ALL` |
| `flow_logs_retention_days` | number | `90` | A CloudWatch Logs retention value |
| `kms_vault_enabled` | bool | `true` | KMS credential vault |
| `db_instance_class` | string | `"db.t4g.medium"` | |
| `db_engine_version` | string | `"16"` | Major alone tracks the newest minor |
| `db_multi_az` | bool | `false` | |
| `db_allocated_storage` | number | `50` | GB |
| `db_max_allocated_storage` | number | `200` | Autoscaling ceiling, GB |
| `db_backup_retention_days` | number | `7` | PITR window |
| `db_deletion_protection` | bool | `true` | Also protects the ALB |
| `db_name` | string | `"vocion"` | |
| `db_master_username` | string | `"vocion_admin"` | |
| `db_kms_key_arn` | string | `""` | Empty: the module creates the data key |
| `db_allowed_extensions` | list(string) | `["plpgsql", "vector", "pg_stat_statements", "pgcrypto", "pg_trgm", "uuid-ossp"]` | `rds.allowed_extensions` |
| `db_backup_window` | string | `"07:00-07:30"` | UTC |
| `db_maintenance_window` | string | `"sun:08:00-sun:08:30"` | UTC |
| `media_bucket_name` | string | `""` | Empty: `<name_prefix>-media` |
| `media_cors_origins` | list(string) | `[]` | Empty: `https://<hostname>` |
| `secret_recovery_window_days` | number | `30` | |
| `backup_enabled` | bool | `true` | |
| `backup_schedule` | string | `"cron(0 3 * * ? *)"` | Clear of the RDS windows |
| `backup_retention_days` | number | `35` | |
| `backup_vault_lock_enabled` | bool | `true` | Governance mode |
| `backup_vault_lock_min_retention_days` | number | `7` | |
| `backup_vault_lock_max_retention_days` | number | `400` | |
| `backup_copy_vault_arn` | string | `""` | Vault in another account to copy into |
| `backup_copy_retention_days` | number | `35` | |
| `backup_accept_copies_from_account_ids` | list(string) | `[]` | Accounts allowed to copy into this vault |
| `alarm_emails` | list(string) | `[]` | Subscribed to the alarm topic |
| `db_free_storage_alarm_gb` | number | `5` | |
| `budget_monthly_usd` | number | `0` | 0: no budget |
| `runners_enabled` | bool | `false` | Fargate engineering runners |
| `runner_image` | string | `"ghcr.io/vocion/vocion-runner:5.x"` | |
| `runner_cpu` | number | `2048` | |
| `runner_memory` | number | `4096` | MiB |
| `runner_max_budget_usd` | number | `12` | Per run |
| `runner_wall_clock_minutes` | number | `45` | Per run |
| `runner_git_email` | string | `""` | Empty: `runner@<hostname>` |
| `runner_poll_schedule` | string | `""` | Empty: no fallback poll |
| `bedrock_enabled` | bool | `true` | Bedrock invoke for the box's role |
| `bedrock_models` | list(string) | `["anthropic.*"]` | Model id patterns the box may invoke |
| `bedrock_inference_profile_geography` | string | `"us"` | `us`, `eu`, `apac`: the cross-region profiles allowed, and the regions their models may run in. Empty: in-region only |
| `agentcore_enabled` | bool | `false` | AgentCore harness/runtime/memory IAM for the box |
| `agentcore_harness_role_name` | string | `"VocionAgentCoreHarnessRole"` | Role the box may pass |

## Outputs

| Name | Description |
|---|---|
| `url`, `hostname` | The installation |
| `instance_id`, `session_command` | The box, and how to open a shell on it |
| `deploy_command` | `sudo vocion-deploy [<tag or full sha>]` |
| `public_ip` | The box's egress address |
| `vpc_id`, `public_subnet_ids`, `db_subnet_ids`, `app_security_group_id` | Network |
| `instance_role_name` | Attach further policies from the calling root |
| `alb_arn`, `alb_dns_name`, `waf_web_acl_arn`, `certificate_arn` | Edge (null without the ALB) |
| `alb_access_logs_bucket`, `waf_log_group_name`, `flow_log_group_name` | Where the logs are (null when off) |
| `app_env_secret_name`, `app_env_secret_arn`, `rds_app_secret_name` | Where the values go |
| `deploy_config_parameter` | The SSM parameter the box reads every deploy |
| `db_endpoint`, `db_address`, `db_identifier`, `db_master_secret_arn` | Database |
| `data_kms_key_arn`, `credential_vault_kms_key_arn` | Keys |
| `media_bucket` | Media |
| `backup_vault_arn` | Hand to another installation's `backup_copy_vault_arn` |
| `alarm_topic_arn` | Alarms |
| `runner_cluster`, `runner_secret_name` | Runners (null when off) |

---

## Changing things later

| Change | How |
|---|---|
| A new core release | `sudo vocion-deploy <tag>` on the box. Then set `core_ref` to match, so a rebuilt box comes up on it |
| A secret value | `put-secret-value`, then `sudo vocion-deploy` |
| `app_env`, the ALB on or off, a new RDS endpoint | `tofu apply`, then `sudo vocion-deploy` |
| A new AMI, or a change to `templates/` | Replace the box: `tofu apply -replace=module.vocion.aws_instance.app`. The database and media are not on it |
| Instance size | `tofu apply` (a stop and start) |

## Testing the module

No AWS account needed:

```bash
cd infra/terraform/modules/vocion-stack
tofu init -backend=false && tofu validate && tofu test
```

[`tests/profiles.tftest.hcl`](./tests/profiles.tftest.hcl) plans the module
against a mocked provider in four profiles (Cloud defaults, single box with
SSH, everything on, logging off) and checks that a branch is refused as
`core_ref` and a retention CloudWatch Logs would refuse is refused at plan.
