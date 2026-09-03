# Deploying observability (Langfuse)

Every Vocion deployment that runs agents needs somewhere for traces to
land. Without it, "why did the agent answer that" and "what is this
client costing us in model spend" have no answer — the application log
shows a request, not the reasoning chain, the tool calls, or the token
bill.

This is the deployment side only. What gets traced is a code concern:
`packages/core/src/libs/Langfuse.ts` and the `traceFor()` call sites.

## TL;DR

- **Pick Cloud unless the client cannot let prompt text leave their
  infrastructure.** $29/month against a day of hardening plus owning
  six containers, their backups and their upgrades forever.
- Cloud is three environment variables. Self-hosted is a hostname, six
  secrets, an S3 bucket, a disk decision, and a retention setting.
- Either way, set `LANGFUSE_ENABLED` explicitly, so "no traces" is
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

| | Langfuse Cloud | Self-hosted on the Vocion box |
| --- | --- | --- |
| Deploy work | Three environment variables | Hostname, DNS, six secrets, S3 bucket, disk move, retention |
| Containers added to the box | None | Six |
| Ongoing burden | None | Upgrades, disk growth, backups, ClickHouse |
| Cost | $29/month on Core; free tier exists | Instance size and EBS, plus the engineering time |
| Prompt and completion content | Leaves client infrastructure | Stays on the client's box |
| Recommendation | **Default.** | Only when data residency requires it, or volume makes overage worse than a bigger instance |

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

## Path A — Langfuse Cloud

1. Create an organisation and project at
   [cloud.langfuse.com](https://cloud.langfuse.com).
2. Copy the project's public and secret key.
3. In `infra/aws/.env.production` on the box (sourced from Secrets
   Manager, never committed):

   ```bash
   LANGFUSE_ENABLED=true
   LANGFUSE_BASE_URL=https://cloud.langfuse.com
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_PROJECT_ID=...        # for the in-app deep links
   ```

4. Re-run `infra/aws/bootstrap.sh`.
5. Confirm with `npm run langfuse:smoke`, which sends one trace and
   polls the public API until it appears.

Leave `LANGFUSE_SITE_ADDRESS` unset, and the Caddy site block for
self-hosted Langfuse never binds.

The six self-hosted containers do still start on this path, because the
root `docker-compose.yml` includes the platform file. They are idle and
harmless, but they are not free — see the last open decision below.

## Path B — self-hosted

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

5. **Deploy.** `infra/aws/bootstrap.sh` composes
   `infra/docker-compose.langfuse.prod.yml` last, which is what strips
   the published port, replaces the committed secrets, points storage at
   S3, and disables sign-up. It also moves Docker's `data-root` onto the
   mounted data volume, so ClickHouse stops growing on the root disk.

6. **Set retention.** Langfuse has no environment variable for this. A
   self-hosted instance keeps data forever until a retention period is
   set per project, in Project Settings or through the projects API,
   with a minimum of three days
   ([langfuse.com/docs/data-retention](https://langfuse.com/docs/data-retention),
   checked 2026-09-03). Do it on the first deploy. ClickHouse growth
   tracks LLM call volume, and an ingestion agent generates a lot of it.

7. **Verify.** In order, because each step rules out the one before:

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
- **Temporal and the OTel collector have the same problem.** Same dev
  compose file, same weak defaults, same published host ports (7233,
  8233, 4317, 4318). Only Langfuse is covered here.
- **On Path A the six containers still start.** The root
  `docker-compose.yml` `include:`s `infra/docker-compose.platform.yml`,
  so dropping the `-f` flag from `bootstrap.sh` changes nothing — the
  file comes in through the include either way. Keeping them off a
  Cloud deployment needs either a Compose profile on those services or
  a `replicas: 0` override like the one MinIO already gets. Worth doing:
  it is six containers of memory on a box that would rather spend it on
  the app.
