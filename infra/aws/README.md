# Vocion on AWS — single-EC2 + Docker Compose

The simplest path to a public Vocion URL. One VM runs the Next.js app,
the feedback worker, Caddy (TLS), Postgres, Langfuse, and the 12-
container Onyx retrieval stack. No autoscaling, no ALB, no ECS — right
for pilot/demo. Graduate to App Runner or ECS once traffic justifies it.

## Topology

```
  Internet → :443 → Caddy (TLS) → app:3000
                                  ↓
                              postgres
                              langfuse
                              otel
                              worker (poll loop)
                              onyx (12 containers)
```

All seven services run as Docker containers on the same EC2 instance.
Caddy provisions Let's Encrypt certs automatically.

## Sizing

| Instance | vCPU / RAM | $/hour (us-east-1) | Notes |
|---|---|---|---|
| `r6i.xlarge` | 4 / 32 GB | ~$0.25 | Tight pilot. Onyx can OOM under load. |
| `r6i.2xlarge` | 8 / 64 GB | ~$0.50 | Recommended. Comfortable headroom for Onyx + app. |
| `r6i.4xlarge` | 16 / 128 GB | ~$1.01 | Multiple agents, larger contexts. |

Plus one **200 GB gp3 EBS** volume attached at `/opt/vocion-data` for
Postgres + Langfuse + Onyx persistence. Snapshot lifecycle: 1 per day,
retain 7 (set via AWS CLI: `aws ec2 enable-snapshot-block-public-access` is unrelated; use Data Lifecycle Manager).

## First-time bring-up

```bash
# 1. Launch an Amazon Linux 2023 instance. Pick the size + 200 GB gp3.
#    Security group: 22 (SSH from your IP), 80, 443.
#    Attach an Elastic IP.

# 2. Point a DNS A record at the Elastic IP. (Caddy needs DNS resolving
#    before Let's Encrypt will issue.)

# 3. SSH in.
ssh -i ~/.ssh/your-key.pem ec2-user@<elastic-ip>

# 4. Become root (the bootstrap installs docker + clones the repo).
sudo -i

# 5. Clone the repo.
git clone https://github.com/vocion/core.git /opt/vocion

# 6. Copy + fill in the env file. Don't skip — bootstrap aborts otherwise.
cp /opt/vocion/infra/aws/.env.production.example /opt/vocion/infra/aws/.env.production
vi /opt/vocion/infra/aws/.env.production
# Set: VOCION_HOSTNAME, all (set me) secrets.

# 7. Run bootstrap. Takes 10–15 minutes on first boot (Onyx pulls 12 images).
bash /opt/vocion/infra/aws/bootstrap.sh
```

Visit `https://${VOCION_HOSTNAME}` once Caddy reports the cert is provisioned.

## Updating

```bash
sudo bash /opt/vocion/infra/aws/update.sh           # pull current branch's HEAD
sudo bash /opt/vocion/infra/aws/update.sh v0.3.0    # switch to a tag
sudo bash /opt/vocion/infra/aws/update.sh main      # back to main
```

The script rebuilds the app image, rolling-restarts only `app` + `worker`
(Onyx + Postgres + Caddy stay untouched), applies any new migrations,
re-runs `context:apply`.

## Logs + ops

```bash
# Tail all Vocion containers
docker compose -p vocion logs -f --tail=200

# Single service
docker compose -p vocion logs -f app
docker compose -p vocion logs -f worker
docker compose -p vocion logs -f caddy

# Onyx (separate compose project)
docker compose -p onyx-stack logs -f

# Run a one-shot command inside the app container
docker compose -p vocion exec app sh -c 'cd packages/core && npm run db:studio'
docker compose -p vocion exec app sh -c 'cd packages/core && npm run eval:run -- --dataset sales-assistant-baseline'
```

## AWS profile + IAM

Operator's local AWS CLI uses the `metacto` profile:

```bash
AWS_PROFILE=metacto aws ec2 describe-instances
AWS_PROFILE=metacto aws ssm start-session --target i-...
```

The EC2 instance itself does NOT need an IAM role for the app to run
(secrets come from `.env.production`). Optionally attach a role for:
- CloudWatch logs export (rather than `docker logs`).
- S3-based EBS snapshot lifecycle.
- SSM Session Manager (avoid managing SSH keys).

## DNS + TLS

- Caddy speaks ACME with Let's Encrypt out of the box.
- HTTP-01 challenge requires `:80` reachable. Don't block it in the SG.
- Cert renews automatically every 60–90 days. Caddy logs note it.
- Wildcard certs require DNS-01 — not configured here; one hostname per
  instance is fine for pilot.

## Backups

EBS snapshots cover Postgres + Langfuse data. Belt-and-suspenders: cron
a `pg_dump` to S3:

```bash
# /etc/cron.d/vocion-pgdump
0 3 * * * ec2-user docker compose -p vocion exec -T postgres pg_dump -U postgres vocion | gzip | aws s3 cp - s3://your-bucket/vocion-pg/$(date +\%Y-\%m-\%d).sql.gz
```

## Scaling out

When traffic exceeds one VM, the next-step paths:

1. **Move web tier to App Runner.** Push `vocion-app:latest` to ECR,
   wire App Runner to the repo, point at the same Postgres + Onyx.
   Worker + Onyx stay on the EC2.
2. **Move everything to ECS Fargate.** Each container becomes an ECS
   service; ALB in front; RDS Postgres; Onyx on its own task definition.

Both are documented as future-state in `docs/upgrades/aws-app-runner.md`
(unwritten — add when needed).

## Costs

Single `r6i.2xlarge` + 200 GB gp3 + Elastic IP + 100 GB egress/month:
**~$390/month**. Plus model usage (Anthropic + OpenAI) — variable.
