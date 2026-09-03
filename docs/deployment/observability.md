# Deploying observability (Langfuse)

Every Vocion deployment that runs agents needs somewhere for traces to
land. Without it, "why did the agent answer that" and "what is this
client costing us in model spend" have no answer — the application log
shows a request, not the reasoning chain, the tool calls, or the token
bill.

This is the deployment side only. What gets traced is a code concern:
`packages/core/src/libs/Langfuse.ts` and the `traceFor()` call sites.

## TL;DR

- **Core self-hosts Langfuse by default.** Every deployment comes up
  with somewhere for traces and per-client spend to land, rather than
  waiting on someone to buy a plan. `bootstrap.sh` refuses to deploy
  until it is configured or explicitly opted out of.
- **Langfuse Cloud is a one-line opt-out** —
  `LANGFUSE_SELF_HOSTED_REPLICAS=0` plus three keys. Cheaper in
  engineering time, and worth taking when the client is fine with
  prompt text leaving their infrastructure.
- Self-hosted needs a hostname, six secrets and an S3 bucket. All of it
  is listed in `infra/aws/.env.production.example`.
- **Traces are kept for a year by default** and deleted after that by a
  daily job, which needs the Temporal worker running.
- Set `LANGFUSE_ENABLED` explicitly either way, so "no traces" is
  always something someone chose.

## What Langfuse is, and why a deployment needs one

Langfuse records one entry per LLM call: the prompt, the completion,
token counts, computed cost, latency, and which step of which chain it
belonged to. It also versions prompts and holds eval scores.

Vocion stamps three dimensions on every trace through
`traceFor({ feature, slug, orgId, userId })`:

| Dimension | Tag | Answers |
| --- | --- | --- |
| Feature | `feature:agent.chat` | Which surface is generating spend |
| Organisation | `org:<orgId>` | Which client, on a shared instance |
| Agent or operation | `slug:sales-assistant` | Which agent is expensive |

That tagging is why the Bedrock or Anthropic bill can be broken down at
all. One invoice line becomes per-client, per-agent spend.

## Choosing a path

| | Self-hosted on the Vocion box | Langfuse Cloud |
| --- | --- | --- |
| Which is the default | **Yes** — containers run unless turned off | Opt out with `LANGFUSE_SELF_HOSTED_REPLICAS=0` |
| Deploy work | Hostname, DNS, six secrets, S3 bucket, retention | Three environment variables |
| Containers added to the box | Six | None |
| Ongoing burden | Upgrades, disk growth, backups, ClickHouse | None |
| Cost | Instance size and EBS, plus the engineering time | $29/month on Core; free tier exists |
| Prompt and completion content | Stays on the client's box | Leaves client infrastructure |

Self-hosted is the default because a deployment with no observability is
worse than one that costs an extra hour to stand up: nobody notices the
gap until a client asks what they are being billed for. Cloud is the
better trade whenever the client is comfortable with prompt content
leaving their infrastructure — it removes six containers and their
backups from the box for $29/month, which is less than the engineering
time to look after them. Make that call per client, not per deployment
habit.

Cloud pricing, verified at
[langfuse.com/pricing](https://langfuse.com/pricing) on 2026-09-03:

| Plan | Price | Included | Users | Retention |
| --- | --- | --- | --- | --- |
| Hobby | Free | 50k units/month | 2 | 30 days |
| Core | $29/month | 100k units/month | Unlimited | 90 days |
| Pro | $199/month | 100k units/month | Unlimited | 3 years |

Overage is $8 per 100k units, falling to $7 above 1M. Single sign-on and
role-based access is a $300/month add-on on Pro. Check the page again
before quoting these to a client — they move.

## Path A — Langfuse Cloud (opting out of self-hosting)

1. Create an organisation and project at
   [cloud.langfuse.com](https://cloud.langfuse.com).
2. Copy the project's public and secret key.
3. In `infra/aws/.env.production` on the box (sourced from Secrets
   Manager, never committed):

   ```bash
   LANGFUSE_SELF_HOSTED_REPLICAS=0   # turn the local containers off
   LANGFUSE_ENABLED=true
   LANGFUSE_BASE_URL=https://cloud.langfuse.com
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_PROJECT_ID=...            # for the in-app deep links
   ```

   Leave every self-hosted value blank — `LANGFUSE_SITE_ADDRESS`, the
   secrets, the S3 bucket, the `LANGFUSE_INIT_*` seeds. Without the
   `_REPLICAS=0` line `bootstrap.sh` will stop and tell you they are
   missing, because self-hosting is the default.

4. Re-run `infra/aws/bootstrap.sh`.
5. Confirm with `npm run langfuse:smoke`, which sends one trace and
   polls the public API until it appears.

With `LANGFUSE_SITE_ADDRESS` unset the Caddy site block never binds, and
the six containers stay at zero replicas. The root
`docker-compose.yml` `include:`s the platform file regardless, so the
production overlay holds them off rather than removing them — Compose
has no way to un-declare a service.

## Path B — self-hosted (the default)

### What you are taking on

Six containers, on an instance already running the app, the feedback
worker, Caddy, the application Postgres, Temporal and the OTel
collector:

| Container | Job |
| --- | --- |
| `langfuse-web` | The UI and the ingestion API |
| `langfuse-worker` | Moves ingested events into ClickHouse |
| `langfuse-postgres` | Langfuse's own metadata database |
| `langfuse-clickhouse` | The trace store. The memory-hungry one |
| `langfuse-redis` | The ingestion queue |
| `langfuse-minio` | Object storage — replaced by S3 in production |

`infra/README.md` budgets 4 GB for Langfuse. Metacto's own box is an
`r6i.large` (2 vCPU, 16 GB) with a 100 GB gp3 data volume, which is a
starting point rather than a sizing exercise. ClickHouse is the reason
to go bigger.

### Keeping ClickHouse in its lane

ClickHouse assumes it owns the machine. Left alone it claims
`max_server_memory_usage_to_ram_ratio` of total RAM, which defaults to
**0.9** ([server settings](https://clickhouse.com/docs/operations/server-configuration-parameters/settings),
checked 2026-09-03) — about 57 GB on a 64 GB box. It shares that RAM
with the app, Postgres, Temporal, Redis, Caddy and the two other
Langfuse containers, so an uncapped ClickHouse can starve the thing
clients actually use.

The production overlay caps it in two places, and the ordering between
them is the point:

| Setting | Enforced by | Default | What happens at the limit |
| --- | --- | --- | --- |
| `LANGFUSE_CLICKHOUSE_MEMORY_LIMIT` | the kernel, via the container | `4g` | ClickHouse is killed and restarts. Trace ingestion stops until it is back. |
| `LANGFUSE_CLICKHOUSE_MAX_SERVER_MEMORY_BYTES` | ClickHouse itself | `3221225472` (3 GB) | One expensive query fails with a memory-limit error. The server stays up. |

**The second must stay below the first.** That is what makes ClickHouse
refuse a query rather than get killed. If you raise one, raise both,
keeping ClickHouse's own number lower — and note it is in bytes, while
the container limit takes suffixes like `4g`.

The 4 GB default matches the Langfuse budget in `infra/README.md` and is
safe on the 16 GB box, not only on the 64 GB instance the Terraform
default asks for. On a bigger instance with real trace volume, raising
both is the first tuning knob to reach for.

ClickHouse's own limit is set through
`infra/aws/clickhouse-memory.xml`, mounted read-only into
`config.d/`, which ClickHouse merges into its main config at startup.
The file reads the byte count from the environment variable, so the
compose file stays the single place the number is set.

### Steps

1. **DNS.** An A record for the Langfuse hostname pointing at the
   instance's Elastic IP. Caddy provisions the certificate itself on
   first request.

2. **Generate the secrets.** Fresh per deployment. Never the values in
   `infra/docker-compose.platform.yml` — those are committed to this
   repository.

   ```bash
   openssl rand -base64 32   # NEXTAUTH_SECRET, SALT, each password
   openssl rand -hex 32      # ENCRYPTION_KEY
   ```

   `ENCRYPTION_KEY` is what Langfuse encrypts stored LLM API keys with.
   Losing it loses those keys; changing it makes the stored ones
   unreadable. It belongs in Secrets Manager like everything else.

3. **Create the S3 bucket** for event and media payloads, in the
   deployment's region, with a lifecycle rule. This is the one part of
   Langfuse's storage that can live off the instance, so it should.

4. **Fill in `.env.production`.** Every variable is listed with a
   comment in `infra/aws/.env.production.example`. The two that catch
   people out:

   - `LANGFUSE_BASE_URL` is the *internal* hostname
     (`http://langfuse-web:3000`), because that is how the app reaches
     it. `NEXT_PUBLIC_LANGFUSE_BASE_URL` is the public one, because
     that is where a person's browser has to go. Setting only the first
     produces "Open in Langfuse" links that always fail.
   - `LANGFUSE_INIT_PROJECT_PUBLIC_KEY` / `..._SECRET_KEY` must equal
     `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`. They are the same
     credential seen from the two sides. Mismatched, the app
     authenticates against a project that does not exist and traces
     stop landing silently.

5. **Nothing to switch on.** The containers run by default. What
   `bootstrap.sh` does check, before it will deploy, is that every value
   above is actually present — it lists the missing ones and names the
   three ways forward (fill them in, use Cloud, or turn tracing off)
   rather than starting a Langfuse with blank secrets. It also catches
   the `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_INIT_PROJECT_PUBLIC_KEY`
   mismatch that otherwise makes traces vanish with no error.

6. **Deploy.** `infra/aws/bootstrap.sh` composes
   `infra/docker-compose.langfuse.prod.yml` last, which is what strips
   the published port, replaces the committed secrets, points storage at
   S3, and disables sign-up. It also moves Docker's `data-root` onto the
   mounted data volume, so ClickHouse stops growing on the root disk.

7. **Check retention.** It defaults to one year, so there is nothing to
   set unless this deployment wants a different window — see the section
   below. What does need checking is that the Temporal worker runs
   (`ENABLE_TEMPORAL_WORKER=1`), because that is what executes the
   deletion; without it the default is just a number.

8. **Verify.** In order, because each step rules out the one before:

   ```bash
   # The container is up and not published to the host.
   docker compose -p vocion ps langfuse-web
   docker compose -p vocion port langfuse-web 3000   # expect no mapping

   # A browser can reach it, and sign-up is closed.
   curl -sSf https://traces.<domain>/api/public/health

   # A trace makes the whole round trip.
   npm run langfuse:smoke

   # Langfuse's data is on the data volume, not the root disk.
   docker info --format '{{.DockerRootDir}}'         # /opt/vocion-data/docker
   ```

### Backups

`infra/terraform/snapshots.tf` creates a daily snapshot of the data
volume, keeping seven, selected by the `Name = "vocion-data"` tag. That
covers Langfuse's Postgres and ClickHouse only because `data-root` moved
onto that volume. Snapshots are crash consistent, which Postgres and
ClickHouse both recover from the way they recover from a power cut.
Point-in-time recovery would need WAL archiving, which is a separate
decision nobody has made yet.

## Retention

`LANGFUSE_RETENTION_DAYS` sets how many days of traces to keep. **It
defaults to 365** — one year — so a deployment that configures nothing
still has a bound. An explicit `0` keeps everything forever; the minimum
otherwise is 3.

```bash
LANGFUSE_RETENTION_DAYS=365   # the default; shorten for a chatty deployment
LANGFUSE_RETENTION_DAYS=0     # keep everything, and own the disk growth
```

A year is the default because the unbounded version is what fills the
disk ClickHouse shares with the application database, and it fills it
slowly enough that nobody is watching when it happens. A year also
covers year-over-year cost comparisons and any realistic "what did this
agent do in March" question.

**Vocion enforces this, not Langfuse.** Langfuse has no environment
variable for retention, and its own project-level retention is an
Enterprise feature on self-hosted instances
([langfuse.com/pricing-self-host](https://langfuse.com/pricing-self-host),
checked 2026-09-03) — an open-source self-hosted instance keeps every
trace forever with no way to configure otherwise. So
`services/LangfuseRetentionService.ts` does the pruning through the
public API, with the project keys already in the environment:

- Lists traces older than the cutoff (`GET /api/public/traces?toTimestamp=…`)
- Deletes them in batches of 50 (`DELETE /api/public/traces`), which
  takes their observations and scores with them
- Repeats until a page comes back empty, capped at 200 pages per run so
  a first run against a never-pruned instance cannot run for hours. The
  rest goes on the next run.

It runs on a daily Temporal schedule at 03:20 UTC, created and removed
by the worker on start to match the variable. **It needs the Temporal
worker running** (`ENABLE_TEMPORAL_WORKER=1`); without it the schedule
is never created and nothing is deleted.

This works the same on Langfuse Cloud, where it is usually redundant —
Cloud plans already enforce a data window (30 days on Hobby, 90 on
Core). Setting it there is harmless but pointless unless you want a
shorter window than the plan gives you.

To check what it did:

```bash
# Did the worker create the schedule on start?
docker compose -p vocion logs worker | grep 'Langfuse retention schedule'

# What did the last run delete?
docker compose -p vocion logs worker | grep 'Langfuse retention complete'
```

The schedule itself is `langfuse-retention` in the Temporal UI
(`/dashboard/workflows`, or the Temporal web UI on 8233), which also
shows when it last fired and whether the run failed.

## Turning tracing off

`LANGFUSE_ENABLED=false` and nothing else is required. `traceFor()`
returns a stand-in that accepts spans and generations and records
nothing, `flushTraces()` does nothing, and `/dashboard/observability`
keeps showing spend and run volume from the application's own tables
while explaining that trace search is unavailable.

Do not leave it unset in production and hope. Unset means "on if
credentials are present", which is fine but reads as an accident.

## How the configuration is resolved

One place: `packages/core/src/libs/Langfuse/config.ts`.

| `LANGFUSE_ENABLED` | Credentials | Result |
| --- | --- | --- |
| `false` | Anything | Off. Nothing validated |
| `true` | Present | On |
| `true` | Missing | **Throws at boot**, naming the variable |
| Unset | Both keys present | On |
| Unset | Missing, production | Off, logged once with the reason |
| Unset | Missing, not production | On, against the local compose stack |

Two more variables sit alongside those:

| Variable | Default | Effect |
| --- | --- | --- |
| `LANGFUSE_RETENTION_DAYS` | `365` — one year | Days of traces to keep. `0` keeps everything; minimum otherwise 3 |
| `LANGFUSE_SELF_HOSTED_REPLICAS` | `1` — self-hosted | Set to `0` for Langfuse Cloud, or for no Langfuse at all |

The throw is deliberate. Tracing that has been asked for and silently
does not happen is worse than a deployment that refuses to start, which
is the failure this whole document exists because of: the client used to
be built at import time with fallback credentials aimed at
`localhost:3200`, so every production box had a tracer posting into a
void.

## Local development

Nothing to configure. `npm run dev:up` starts the platform stack and the
resolver falls back to the compose file's demo project outside
production. Langfuse is at http://localhost:3200, with the login in
`infra/README.md`.

`npm run langfuse:smoke` works locally too, and
`npm run langfuse:bootstrap` seeds model prices so cost figures match
`packages/core/src/libs/pricing.ts`.

## Open decisions

Tracked on [vocion-core#95](https://github.com/vocion/vocion-core/issues/95):

- **One Langfuse per client, or one shared instance with a project per
  client?** `traceFor()` already tags `org:<orgId>`, so a shared
  instance can be sliced per client for viewing. Shared would need core
  to route per-org credentials, the way per-org platform API keys work.
  Per-client is the current assumption.
- **Their weak defaults and published ports** (7233, 8233, 4317, 4318)
  come from the same dev compose file Langfuse's did. Only Langfuse is
  covered here.
- **Temporal and the OTel collector are still on laptop defaults.**
  Unlike Langfuse they have no managed alternative to fall back to, so
  they were left out of the replica default as well as the secret
  handling.
