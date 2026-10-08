# Vocion on AWS — single-EC2 + Docker Compose

The simplest path to a public Vocion URL. One VM runs the Next.js app, the
feedback worker, Caddy (TLS), Postgres (pgvector), and Langfuse — which
self-hosts by default and is six containers on its own. Configured by
[`docs/deployment/observability.md`](../../docs/deployment/observability.md),
which also covers opting out to Langfuse Cloud. No
autoscaling, no ALB, no ECS — right for pilot/demo. Graduate to App Runner
or ECS once traffic justifies it.

## Topology

```
  Internet → :443 → Caddy (TLS) → app:3000
                                  ↓
                              postgres (pgvector + FTS)
                              langfuse
                              otel
                              worker (poll loop)
```

All services run as Docker containers on the same EC2 instance. Caddy
provisions Let's Encrypt certs automatically. Retrieval is first-party:
pgvector HNSW + Postgres FTS in the app DB itself, served by
`services/RetrievalService`.

## Sizing

| Instance | vCPU / RAM | $/hour (us-east-1) | Notes |
|---|---|---|---|
| `t3.large` | 2 / 8 GB | ~$0.08 | Demo / pilot. Embedding throughput limited. Can't build the app image itself (below). |
| `r6i.large` | 2 / 16 GB | ~$0.13 | Comfortable for small org corpora. |
| `r6i.xlarge` | 4 / 32 GB | ~$0.25 | Multiple agents, larger contexts. |

The image builds on the box, beside the running stack. A box's first build
starts with an empty build cache and needs about 7.9 GB; every build after it
reuses the cache and needs about 4.4 GB (measured on a 16 GB GitHub runner,
#670). So a `t3.large` can't run its own first build, even with the stack
stopped: a build limited to 2 CPUs and 6.8 GB ran out of memory. On a
`t3.large`, get the image onto the box some other way, or start on a bigger
instance.

Plus one **100 GB gp3 EBS** volume attached at `/opt/vocion-data` for
Postgres + Langfuse persistence. `bootstrap.sh` moves Docker's
`data-root` onto this volume, which is what puts the named volumes —
including Langfuse's ClickHouse — on it rather than on the root disk.

Snapshot lifecycle: 1 per day, retain 7, created by the Data Lifecycle
Manager policy in `infra/terraform/snapshots.tf`. It selects the volume
by its `Name = "vocion-data"` tag.

## First-time bring-up

```bash
# 1. Launch an Amazon Linux 2023 instance. Pick the size + 100 GB gp3.
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

# 7. Run bootstrap. Takes 3–5 minutes on first boot.
bash /opt/vocion/infra/aws/bootstrap.sh
```

Visit `https://${VOCION_HOSTNAME}` once Caddy reports the cert is provisioned.

## Updating

```bash
sudo bash /opt/vocion/infra/aws/update.sh           # pull current branch's HEAD
sudo bash /opt/vocion/infra/aws/update.sh v0.3.0    # switch to a tag
sudo bash /opt/vocion/infra/aws/update.sh main      # back to main
```

The script gets the app image, applies any new migrations, then
rolling-restarts only `app` + `worker` (Postgres + Caddy stay untouched).

**Pull a CI-built image rather than building here.** A first build needs
about 7.9 GB of memory, and on this box it competes with Postgres and
Langfuse (#670). Build in CI with `push-app-image.sh` and pass the image in:

```bash
sudo VOCION_APP_IMAGE=<registry>/<repository>:<commit> bash /opt/vocion/infra/aws/update.sh <git-ref>
```

`pull-app-image.sh` logs in to ECR with the instance role, pulls with three
tries, refuses an image built for a different `NEXT_PUBLIC_APP_URL`, and tags
it `vocion-app:latest`. A failed pull stops the deploy before migrations, with
the old containers still serving. `bootstrap.sh` takes the same variable. Pass
the ref the image was built from, so the migrations match it. The CI job, IAM
and ECR setup are in
[docs/deployment/parent-project-pattern.md](../../docs/deployment/parent-project-pattern.md#build-the-app-image-in-ci-the-box-only-pulls-it).
The ECR login belongs to root, so check a pull by hand with `sudo docker pull`.

**Without `VOCION_APP_IMAGE`, both scripts build on the box** and log `no
VOCION_APP_IMAGE given`. If you passed one and still see that line, sudo
stripped the variable (see the sudo note under Migrations); use
`sudo env VOCION_APP_IMAGE=... bash ...`.

The build keeps Turbopack's build cache on the box between deploys
(#670), so a deploy recompiles only what changed. That needs Docker's buildx
plugin, so both scripts run `install-buildx.sh` before they build. Amazon
Linux 2023's `docker` package, which `bootstrap.sh` installs, already ships it
(buildx 0.12.1 with Docker 25.0.14, checked 2026-09-28), so on most boxes the
script does nothing. On a box without it, the first deploy logs `installing
docker-buildx plugin`, downloads a pinned release from GitHub and checks its
checksum. A failed download stops
the deploy before the build, with the old containers still serving.

Migrations run **before** the containers roll, and a migration failure
aborts the deploy with the old containers still serving. That order does
not remove the schema-skew window — it puts the outgoing release in front
of the new schema for the length of the roll — so migrations must stay
backward-compatible with the release they are replacing: expand in one
deploy, contract in a later one. The script does not seed workspace
content, see [Workspace content](#workspace-content).

## Migrations

`infra/aws/apply-migrations.sh` applies `packages/core/migrations/*.sql`
through `psql` in the Postgres container, recording each file in a
`__pgsql_migrations` table. `drizzle-kit` cannot be used here: it is a
devDependency that the Next.js standalone build trims out of the runtime
image.

```bash
sudo bash /opt/vocion/infra/aws/apply-migrations.sh
```

Both `bootstrap.sh` and `update.sh` call it and neither swallows its exit
code — a failed migration fails the deploy.

**Baselining an existing database.** On a box whose schema was migrated
some other way, `__pgsql_migrations` is empty, and replaying every file
would fail on the first `CREATE TABLE`. The script detects this and
stops rather than guessing. It baselines itself automatically when
`drizzle.__drizzle_migrations` exists; otherwise state the position once:

```bash
# See what it would do, without writing anything:
sudo bash /opt/vocion/infra/aws/apply-migrations.sh --check

# Schema is fully up to date:
sudo bash /opt/vocion/infra/aws/apply-migrations.sh --baseline all

# Applied by hand up to a known file:
sudo bash /opt/vocion/infra/aws/apply-migrations.sh --baseline 0042_thing.sql
```

Use the flag rather than `sudo MIGRATIONS_BASELINE=... bash`, which the
default sudoers `env_reset` can refuse for a user with narrower sudo rights
than Amazon Linux 2023's `ec2-user` (whose `ALL` rule lets it through,
checked 2026-09-28). The env var still works when it is
already exported. An explicit baseline takes precedence over the drizzle
history, so it also covers a database drizzle migrated part of the way
and a person finished by hand.

To find the last applied file, open the newest migrations and check
whether what they create already exists:

```bash
sudo docker exec vocion-postgres psql -U postgres -d vocion -c '\d <table>'
```

**Migrations that use `CONCURRENTLY`.** Each file normally applies inside
one transaction, so a mid-file error rolls back. `CREATE INDEX
CONCURRENTLY` cannot run inside a transaction, so a file containing it is
applied unwrapped and the log says so — a partial failure in that file
stays partial and needs a person.

## Workspace content

Neither deploy script seeds workspace content. A deployment mounts its
own workspace tree and points `WORKSPACE_PATH` at it; apply changes with
`npm run workspace:apply` from a checkout with dev dependencies
installed, or through the in-product workspace editor. See
[docs/workspace.md](../../docs/workspace.md).

## After a deploy: verify-full.sh

`update.sh` and a parent's health gate prove the new build answers.
`verify-full.sh` proves a person can use it: `/version.txt` is the build the
deploy pinned, a QA account signs in and loads a page, and one chat turn
comes back with an answer. Each failure exits 1 with its reason on one
`::error::verify-full:` line.

```bash
HOST=app.example.com PIN=<release, e.g. v5.1.0, or the pinned commit> \
QA_EMAIL=... QA_PASSWORD=... VERIFY_PAGE_PATH=/w/<workspace>/dashboard \
  bash infra/aws/verify-full.sh
```

The parameters are documented at the top of the script and in
[release lines](../../docs/deployment/release-lines.md#after-the-deploy-prove-it-from-outside).
`PIN` as a release name needs a build that knows its tag: a Docker build has
no `.git`, so build it with
`--build-arg VOCION_BUILD_DESCRIBE=$(git -C vocion-core describe --tags --long)`
(tags fetched), or pin by commit.
It runs from anywhere with `curl` and `jq` (a CI runner, an operator's
machine), not on the box.

## Testing the deploy scripts

```bash
bash infra/aws/deploy-scripts.test.sh
```

Runs on any machine with Docker. It starts a throwaway `pgvector`
container, exercises every branch of `apply-migrations.sh`, and runs both
`update.sh` and `bootstrap.sh` against fake `docker`/`git` binaries — the
migration step really executes against the test database — to assert that
migrations precede the container roll and that a failed migration aborts
the deploy instead of reporting success. Everything it creates is removed
on exit. `bootstrap.sh`'s system-prereq and docker-data-root sections are
skipped by the fakes; the rest of it runs. `install-buildx.sh` runs against a
fake `curl`, so the tests check its checksum and failure handling without
downloading anything. `pull-app-image.sh` and `push-app-image.sh` run against
fake `aws` and `docker`, covering the ECR login, pull retries, the app-URL
check, the refusals, and that a deploy given an image never builds.

`verify-full.sh` has its own unit test
(`packages/core/src/scripts/verifyFull.test.ts`), which runs it against a
local server that answers the way the app does.

Those fakes don't build anything. `.github/workflows/app-image.yml` does:
on a pull request that touches the Dockerfile or either image script, it
builds and pushes to a registry on the runner twice (the second time proving
the cache works), pulls the image the way a box does, checks the app-URL
refusal, applies the migrations and boots the image. Run it by hand from the
Actions tab after any other change to the image build.

## Logs + ops

```bash
# Tail all Vocion containers
docker compose -p vocion logs -f --tail=200

# Single service
docker compose -p vocion logs -f app
docker compose -p vocion logs -f worker
docker compose -p vocion logs -f caddy

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

EBS snapshots of the data volume cover Postgres and Langfuse data,
because `bootstrap.sh` puts Docker's volumes there. They are crash
consistent, not point-in-time: recovery replays like a power cut, and
anything written since the last snapshot is gone. Belt-and-suspenders,
cron a `pg_dump` to S3:

```bash
# /etc/cron.d/vocion-pgdump
0 3 * * * ec2-user docker compose -p vocion exec -T postgres pg_dump -U postgres vocion | gzip | aws s3 cp - s3://your-bucket/vocion-pg/$(date +\%Y-\%m-\%d).sql.gz
```

## Scaling out

When traffic exceeds one VM, the next-step paths:

1. **Move web tier to App Runner.** Push `vocion-app:latest` to ECR,
   wire App Runner to the repo, point at the same Postgres. Worker stays
   on the EC2.
2. **Move everything to ECS Fargate.** Each container becomes an ECS
   service; ALB in front; RDS Postgres (pgvector extension on the RDS
   instance).

Both are documented as future-state in `docs/upgrades/aws-app-runner.md`
(unwritten — add when needed).

## Costs

Single `r6i.large` + 100 GB gp3 + Elastic IP + 100 GB egress/month:
**~$120/month**. Plus model usage (Anthropic + OpenAI) — variable.
