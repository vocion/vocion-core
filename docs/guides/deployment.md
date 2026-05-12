---
title: Deployment
description: Ship Vocion to production on AWS or any Docker-friendly host. One-VM with Caddy for TLS; production-ready in under an hour.
nav_order: 70
---

# Deployment

Vocion ships as a single Docker image. The reference deployment is a single EC2 instance with Caddy fronting Docker Compose — production-ready, ~30 min from blank account to live URL, no Kubernetes required. Same image runs anywhere Docker does (Fly, Render, Hetzner, your own VM).

This guide covers the AWS reference path. Adapt freely.

## Architecture at a glance

```
┌──────────────────────────────────────────────────────────────┐
│   EC2 instance (t3.large or larger)                          │
│                                                              │
│   Caddy (TLS, www→apex, security headers)                    │
│     │                                                        │
│     ├─► vocion-app          (Next.js standalone, :3000)      │
│     ├─► postgres            (16-alpine, pgvector)            │
│     ├─► langfuse stack      (web + worker + clickhouse +     │
│     │                        postgres + redis + minio)       │
│     ├─► temporal stack      (server + UI + postgres)         │
│     └─► otel-collector      (:4317 grpc, :4318 http)         │
└──────────────────────────────────────────────────────────────┘
```

All on one box. The single-EC2 deployment is intentional: ~$80/mo of infra runs the full platform comfortably for a small team. Scale up the instance or split services to RDS when you need to; nothing about the architecture forces an early migration.

## Prerequisites

- AWS account with `aws` CLI configured (profile must have EC2, KMS, Route 53, Secrets Manager).
- A registered domain. Hosted zone in Route 53 (the reference Terraform creates the records).
- Anthropic API key + OpenAI API key (the latter is required as of v0.3 for retrieval embeddings).
- Clerk account with a production instance + at least one organization configured.

## One-time setup with OpenTofu

Infrastructure as code lives in `infra/terraform/`. It provisions:

- VPC + public subnet + IGW + Security Group.
- EC2 instance with EBS data volume (200 GB gp3).
- IAM role with KMS + Secrets Manager access.
- Elastic IP + Route 53 A records for apex + `www`.
- AWS KMS key for the CredentialVault.
- Secrets Manager `vocion/production` for runtime env.

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars  # fill in domain, aws_profile, key_name
tofu init
tofu apply
```

The first `apply` takes ~3 min. EIP + DNS settle in another ~5. Watch `Outputs:` for the public IP and Secrets Manager ARN.

## Populating secrets

Real production env values land in **AWS Secrets Manager**, not in the Docker image. The bootstrap script reads them on container start and materializes a `.env.production` file inside the EC2.

```bash
aws secretsmanager update-secret \
  --secret-id vocion/production \
  --secret-string file://infra/aws/.env.production
```

See `infra/aws/.env.production.example` for the full schema. Critical vars:

| Var | Required | Notes |
|---|---|---|
| `VOCION_HOSTNAME` | yes | The apex domain. Caddy provisions TLS for this. |
| `NEXT_PUBLIC_APP_URL` | yes | `https://<your-domain>`. Sitemap + canonical URLs read this. |
| `DATABASE_URL` | yes | Default routes to the in-network `postgres` service. Replace with RDS to split out. |
| `ANTHROPIC_API_KEY` | yes | Main agent + classifier models. |
| `OPENAI_API_KEY` | yes (v0.3+) | Required for retrieval embeddings (`text-embedding-3-small`). |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Production Clerk instance. |
| `LANGFUSE_*` | recommended | Observability + cost attribution. Self-hosted via the platform compose. |
| `VOCION_AGENT_RUNTIME` | yes | Set to `deepagents` to opt into the v0.2+ runtime. |

## Building + deploying the image

The Docker image is multi-stage:

```bash
docker build -t vocion-app:latest -f packages/core/Dockerfile .
```

The build step:
1. Installs deps with `npm ci --ignore-scripts`.
2. Runs `next build` with stub env vars (real values land at runtime).
3. Runs `pagefind` against the static output to produce the docs search index.
4. Copies `docs/`, `requirements/`, `context/`, `migrations/`, `README.md` into the runtime image.

The runner uses `node packages/core/server.js` (Next.js standalone). Default port 3000.

## In-place updates

Once the EC2 is running, push new versions via:

```bash
ssh ec2-user@<your-ec2>
sudo bash /opt/vocion/infra/aws/update.sh [git-ref]
```

`update.sh`:
1. Pulls the new git ref (default: HEAD of current branch).
2. Rebuilds `vocion-app:latest` from the new tree.
3. Rolling-restarts the app + worker containers. Caddy keeps existing connections open.
4. Applies any new Drizzle migrations.
5. Applies the latest `context/`.

Total downtime is ~5 s during the container swap.

## What to monitor

- **Langfuse UI** at `https://langfuse.<your-domain>` (or your cloud Langfuse instance) — every LLM call, sliceable by org / user / feature / agent / model.
- **Temporal UI** at `https://temporal.<your-domain>` — workflow execution, retries, schedule status.
- **CloudWatch logs** for the EC2 — Docker stdout/stderr surfaces here via the awslogs driver.
- **Spend** — Langfuse computes USD per generation when models are registered (`npm run langfuse:bootstrap` once on each environment).

## Scaling pressure points

When the single-EC2 setup runs out of room:

| Pressure | First move |
|---|---|
| Postgres CPU / IOPS | Move to RDS, keep everything else on EC2. |
| `knowledge_chunk` row count > 10M | Move retrieval to a dedicated read-replica + HNSW tuning. |
| Concurrent agent runs | Vertically scale the EC2 (16 vCPU / 64 GB RAM). Beyond that, split the app container to a dedicated tier. |
| Ingestion volume | Run more Temporal workers; they're stateless. |
| TLS cert + cost | Move Caddy to a managed ALB + ACM cert. |

Stay on one box as long as you can — the operational simplicity is worth more than the marginal cost optimization.

## Self-hosting without AWS

The Dockerfile + compose files don't depend on AWS. To run elsewhere:

1. Provision a Linux VM (>=4 vCPU, >=16 GB RAM, >=200 GB SSD).
2. Install Docker.
3. Clone the repo.
4. Fill in `.env.production` next to `infra/aws/docker-compose.prod.yml`.
5. `docker compose -f infra/aws/docker-compose.prod.yml up -d`.

No magic. See [self-hosting](./self-hosting.md) for more.

## Cross-references

- [CLI reference](../reference/cli.md) — every `npm run` script you'll touch.
- [Observability](./observability.md) — Langfuse stack + trace dimensions.
- [Troubleshooting](./troubleshooting.md) — common gotchas during deployment.
- [Authentication reference](../reference/authentication.md) — Clerk + auth-guard wiring.
