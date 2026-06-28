# Vocion on AWS — OpenTofu

One `tofu apply` provisions every AWS resource needed to serve
`https://vocion.ai` from a single EC2 instance:

- VPC + public subnet + IGW + security group
- EC2 (Amazon Linux 2023, `r6i.2xlarge`) with IAM role for Secrets Manager
- Elastic IP (stable across reboots)
- 200 GB gp3 data volume mounted at `/opt/vocion-data` (`prevent_destroy`)
- Secrets Manager secret `vocion/production` (JSON-encoded env vars)
- Route 53 `vocion.ai` + `www.vocion.ai` A records → Elastic IP

The instance's cloud-init user-data fetches the secret, writes
`/opt/vocion/infra/aws/.env.production`, and hands off to the
existing `infra/aws/bootstrap.sh` (Phase F).

## Prerequisites

- **OpenTofu** ≥ 1.6. Install: `brew install opentofu`.
- **AWS profile `metacto`** in `~/.aws/credentials`. Test:
  `AWS_PROFILE=metacto aws sts get-caller-identity`.
- An **EC2 key pair** in `us-east-1`. Create one:
  ```bash
  AWS_PROFILE=metacto aws ec2 create-key-pair \
    --key-name vocion-prod \
    --region us-east-1 \
    --query 'KeyMaterial' --output text > ~/.ssh/vocion-prod.pem
  chmod 400 ~/.ssh/vocion-prod.pem
  ```
- The **vocion.ai hosted zone** in Route 53 (id `Z06298783TMOTVTWTEX01`).
  Pre-existing; no action needed.

## First deploy

```bash
cd infra/terraform

# 1. Fill in secrets.
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars
#   - Set every `SET_ME` value (Anthropic, Clerk, Langfuse keys).
#   - Confirm `key_name` matches the keypair you created.
#   - Optionally tighten `ssh_cidr` to your operator IP.

# 2. Init providers.
tofu init

# 3. Sanity-check.
tofu fmt -check
tofu validate
tofu plan -out vocion.tfplan

# 4. Provision.
tofu apply vocion.tfplan

# 5. Wait ~3–5 min. The EC2 user-data clones the repo, builds the
#    app image, brings up the platform stack, runs migrations + workspace:apply.
#    Tail progress:
ssh -i ~/.ssh/vocion-prod.pem ec2-user@$(tofu output -raw public_ip) \
  'sudo tail -f /var/log/cloud-init-output.log'

# 6. Verify DNS + TLS:
dig vocion.ai @8.8.8.8 +short      # → Elastic IP from `tofu output public_ip`
curl -sI https://vocion.ai/        # → 200 or 307
```

Open `https://vocion.ai`. The first request triggers Caddy's
Let's Encrypt provisioning (~30 seconds); subsequent requests are
served instantly.

## Updating secrets

Edit `terraform.tfvars`, then:

```bash
tofu apply -auto-approve
ssh -i ~/.ssh/vocion-prod.pem ec2-user@$(tofu output -raw public_ip) \
  'sudo bash /opt/vocion/infra/aws/bootstrap.sh'   # re-fetches secret + re-runs migrations
```

The `bootstrap.sh` re-run is idempotent; only the env vars rotate.

## Updating the app (zero-downtime rolling deploy)

```bash
ssh -i ~/.ssh/vocion-prod.pem ec2-user@$(tofu output -raw public_ip) \
  'sudo bash /opt/vocion/infra/aws/update.sh main'
```

Postgres + Caddy stay running; only `app` + `worker` rebuild + restart.

## Outputs

After apply:

```bash
tofu output
#
# data_volume_id = "vol-..."
# instance_id    = "i-..."
# public_ip      = "1.2.3.4"
# secret_arn     = "arn:aws:secretsmanager:us-east-1:...:secret:vocion/production-XXX"
# ssh_command    = "ssh -i ~/.ssh/vocion-prod.pem ec2-user@1.2.3.4"
# url            = "https://vocion.ai"
```

## Migrating state to S3

When a second operator joins, move `.tfstate` to S3 + DynamoDB:

```bash
# Create the bucket + lock table once:
AWS_PROFILE=metacto aws s3 mb s3://vocion-tfstate --region us-east-1
AWS_PROFILE=metacto aws s3api put-bucket-versioning \
  --bucket vocion-tfstate --versioning-configuration Status=Enabled
AWS_PROFILE=metacto aws dynamodb create-table \
  --table-name vocion-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1

# Uncomment the `backend "s3"` block in providers.tf, then:
tofu init -migrate-state
```

State move is one-time; future `tofu plan` runs read from S3.

## Tearing it down

```bash
# Pop the prevent_destroy guard on the data volume first if you
# actually want to delete pgdata. Otherwise the destroy halts there.
tofu destroy
```

The Secrets Manager secret enters a **7-day deletion window** rather
than being purged immediately. Restore via
`aws secretsmanager restore-secret --secret-id vocion/production` if
the destroy was a mistake.

## Costs (us-east-1, on-demand)

| Resource | $/month |
|---|---|
| `r6i.2xlarge` EC2 | ~$360 |
| 200 GB gp3 EBS data volume | ~$16 |
| 32 GB gp3 root volume | ~$3 |
| Elastic IP (attached, no charge; detached is $4/mo) | $0 |
| Route 53 hosted zone + queries | ~$0.50 |
| Secrets Manager (1 secret) | $0.40 |
| Data egress (~100 GB) | ~$9 |
| **Total** | **~$390/mo** |

Plus Anthropic + Langfuse cloud — variable.

## Follow-ups (documented in the plan's "out of scope")

- ECR + image push (faster boots).
- RDS Postgres (split the DB onto a managed service).
- App Runner / ECS Fargate (autoscale the web tier).
- WAF / CloudFront (rate-limiting + edge cache).
- Multi-AZ failover.
