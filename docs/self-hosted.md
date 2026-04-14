# Self-Hosted Installation

Runtime is Apache 2.0. These are the steps for standing up CoreContext on your own infrastructure — local dev, a single VPS, or a Kubernetes cluster. Same codebase, same data model, same MCP surface as MetaCTO Cloud.

If you'd rather we run it for you, see [MetaCTO Cloud](./managed-operations.md).

## Requirements

| | Minimum | Recommended |
|---|---|---|
| **Node.js** | 20.x | 22.x LTS |
| **Postgres** | 16 | 16 or 17 |
| **Docker** | optional | recommended (Postgres + retrieval stack) |
| **Memory** | 2 GB | 8 GB+ |
| **Disk** | 5 GB | depends on document volume — plan ~1 GB per 100k indexed chunks |
| **OS** | macOS, Linux, WSL2 | Linux (for production) |

You'll also need API keys for at least one LLM provider — OpenAI or Anthropic is enough to start.

## Quick start (local dev)

```bash
# 1. Clone + install
git clone https://github.com/metacto/context-stack.git
cd context-stack
npm install

# 2. Configure env
cp .env.example .env.local
# Edit .env.local — at minimum set:
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/corecontext
#   OPENAI_API_KEY=sk-...
#   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
#   CLERK_SECRET_KEY=...

# 3. Start Postgres
docker compose up -d postgres

# 4. Apply schema + reference context
npm run db:migrate
npm run context:apply

# 5. Run dev server
npm run dev:next
# → http://localhost:3000
```

That's the whole thing. Sign in via Clerk, land on the dashboard, poke around.

## Environment variables

Full list lives in `.env.example`. The essential ones:

### Required

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend key |
| `CLERK_SECRET_KEY` | Clerk backend key |
| `OPENAI_API_KEY` | At least one LLM provider. See "LLM providers" below for alternatives |

### Recommended

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables skills with `provider: anthropic` |
| `ONYX_API_URL` + `ONYX_API_KEY` | Retrieval backend (until Phase 5 native pgvector lands) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | LLM observability |
| `CORECONTEXT_ORG_ID` | Default org for MCP server (otherwise uses Clerk session) |
| `CONTEXT_PATH` | Path to context directory. Default `context/metacto` |
| `CORECONTEXT_PLUGINS` | Comma-separated plugin specifiers — npm packages or local paths |

### Optional

| Var | Default | Purpose |
|---|---|---|
| `CONTEXT_AUTO_COMMIT` | `true` | MCP `context_write_*` commits to git |
| `CONTEXT_AUTO_APPLY` | `true` | MCP `context_write_*` applies to DB after write |
| `STRIPE_SECRET_KEY` | — | Billing (skip if not using) |
| `SENTRY_DSN` | — | Error monitoring |
| `BETTER_STACK_SOURCE_TOKEN` | — | Log aggregation |

## Database setup

### Managed Postgres

Any Postgres 16+ works — Neon, Supabase, RDS, Cloud SQL. Set `DATABASE_URL` and run:

```bash
npm run db:migrate
```

### Self-hosted Postgres

The repo ships a `docker-compose.yml` for local dev:

```bash
docker compose up -d postgres
```

For production, run Postgres separately (Helm chart, Terraform, `apt install`, whatever fits your ops).

### Migrations

Migrations are Drizzle-managed. To apply schema:

```bash
npm run db:migrate
```

To generate a new migration after editing `src/models/Schema.ts`:

```bash
npm run db:generate
npm run db:migrate
```

Migrations are idempotent; safe to re-run.

### Context seeding

Context (agents, skills, object types, workflows) lives in `context/<org>/` as YAML + markdown. Apply to DB:

```bash
npm run context:apply
```

This is idempotent — subsequent runs only touch rows that changed. Every apply records a `context_version` audit row.

To bootstrap a new tenant from existing DB state:

```bash
npm run context:export -- --org <orgId> --name <dirName>
```

See [`context/README.md`](../context/README.md) for authoring.

## LLM providers

CoreContext supports multiple LLM hosts; each plugin skill picks one via the `provider` field.

| Provider | Status | Required env |
|---|---|---|
| `openai` | ✓ shipped | `OPENAI_API_KEY` |
| `anthropic` | ✓ shipped | `ANTHROPIC_API_KEY` |
| `vertex` | roadmap (Phase 5) | (GCP creds, coming) |
| `azure-openai` | roadmap (Phase 5) | (endpoint + key, coming) |

If a skill declares `provider: anthropic` and you haven't set `ANTHROPIC_API_KEY`, the first invocation throws with a clear message. The platform never silently falls back.

## MCP server

The MCP server lets you author skills + workflows and inspect runs from Claude Code, Claude Desktop, Cursor, Zed, or any MCP client.

### Claude Code

```bash
claude mcp add corecontext -- npm --prefix /absolute/path/to/context-stack run mcp:serve
```

Or add to `.mcp.json`:

```json
{
  "mcpServers": {
    "corecontext": {
      "command": "npm",
      "args": ["--prefix", "/abs/path", "run", "mcp:serve"],
      "env": {
        "CORECONTEXT_ORG_ID": "org_...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

### Other MCP clients

Point any stdio-capable client at `tsx src/interfaces/mcp/bin.ts`. See [`docs/mcp.md`](./mcp.md) for the full tool reference.

## Plugins

Plugins are npm packages (or local paths) that register additional skills. Install via the `CORECONTEXT_PLUGINS` env var:

```bash
export CORECONTEXT_PLUGINS=@acme/plugin-a,./local-plugins/my-skill.ts
npm run mcp:serve
```

Authoring guide: [`docs/plugins.md`](./plugins.md).

## Production deployment

### Docker

Build the Next.js image:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
```

Deploy with any container orchestrator (Fly, Railway, Render, ECS, GKE, EKS).

### Reverse proxy + TLS

Terminate TLS at nginx / Caddy / your load balancer; forward to the app on port 3000. Set `NEXT_PUBLIC_APP_URL` to your public URL so Clerk callbacks resolve correctly.

### Scaling considerations

- **Stateless app tier** — run as many replicas as you need behind a load balancer. Session lives in Clerk.
- **Postgres is the source of truth** — for high-traffic deployments, use a managed service with read replicas.
- **MCP server is single-tenant today** (stdio-only). HTTP + OAuth transport lands in Phase 2 for multi-tenant use.
- **Workflow durability** — in v1 workflows store state in `workflow_run` rows. If the process dies mid-run, the run sits paused at its last persisted step. Temporal-backed durability is Phase 7 work.

### Backups

Back up Postgres. That's where every skill run, approval decision, context version, and audit record lives. The `context/<org>/` directory is also important, but it's in git — git is the backup.

## Multi-tenant setup

Out of the box, CoreContext is multi-tenant — each Clerk organization is its own tenant. Rows are scoped by `org_id` via Clerk auth guards, and each org has its own `context/<org>/` directory applied independently.

To onboard a new tenant:

1. Create the Clerk organization
2. Create `context/<new-org>/context.yaml` + empty subdirectories
3. `CONTEXT_PATH=context/<new-org> CORECONTEXT_ORG_ID=<clerk-org-id> npm run context:apply`
4. (Optional) seed objects via scripts or admin UI

Each tenant can have its own plugins enabled via `CORECONTEXT_PLUGINS` — if you're running multi-tenant from one process, list the union. Per-tenant plugin enablement is planned for Phase 3 v0.3.

## Observability

- **LLM traces** — Langfuse is wired by default. Set `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` + `LANGFUSE_HOST`. Every skill run creates a trace.
- **Errors** — Sentry via `SENTRY_DSN`.
- **Logs** — LogTape writes to stdout by default, Better Stack if configured.
- **Skill + workflow history** — in the DB. Visit `/dashboard/review` for pending items, or query `skill_run` / `workflow_run` directly.

## Upgrading

```bash
git pull
npm install
npm run db:migrate
npm run context:apply
```

Migrations are forward-only and idempotent. Context applies are idempotent. No downtime needed for typical upgrades; new schema changes that would break the running app are released with migration notes.

## Troubleshooting

**`npm run dev` aborts with `Aborted()` from PGLite.**
The built-in `db-server:file` target uses PGLite and sometimes gets into a bad state. Switch to Docker Postgres: `docker compose up -d postgres && npm run dev:next`.

**`npm run context:apply` fails with `context manifest not found`.**
Your `CONTEXT_PATH` is wrong or `context/<org>/context.yaml` is missing. The loader walks from the path root.

**MCP server reports `OPENAI_API_KEY is not set`.**
Env not getting loaded. If running via `npm run mcp:serve`, the `dotenv -c --` prefix should handle it. Direct `tsx src/interfaces/mcp/bin.ts` requires the env already exported.

**Plugin loader errors on first boot.**
The specifier in `CORECONTEXT_PLUGINS` must resolve as a Node ES module — either an npm package name or an absolute/relative path to a `.js`, `.mjs`, or `.ts` file. The loader logs every failure + still starts with whatever did load.

**Workflows get stuck at "paused".**
Paused workflows are waiting for approval. Visit `/dashboard/review` or call `workflow_run_resume` via MCP.

**"Database is inconsistent with context."**
Run `npm run context:check` to see the diff. If something was written to the DB outside context-as-code (old seed scripts, manual edits), either export with `npm run context:export` to capture it, or edit the context repo to match and re-apply.

## What's not self-hostable (today)

Nothing critical — everything in the runtime is Apache 2.0 and runs on your infra. Some optional integrations require accounts with third parties:

- Clerk (auth) — required, but they have a free tier
- Stripe (billing) — optional, only if you're charging end users
- Langfuse — optional, and can be self-hosted itself

A fully-offline deploy is possible if you swap Clerk for a self-hosted auth provider (next-auth, Keycloak). That integration isn't in the repo today — file an issue if it's blocking for you.

## Support

- Docs: `/dashboard/docs` (in-product) or `docs/` in the repo
- Source: the repo
- Issues: GitHub issues on the public repo (Phase 8 once OSS launches)
- Managed ops: MetaCTO Cloud (when a second set of eyes + SLAs make sense)
