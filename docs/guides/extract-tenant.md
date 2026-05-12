# Extracting a tenant context repo

Vocion is designed so every tenant's authored content — Sources, Objects, Skills, Workflows, Agents — lives in a **separate git repo** (a "tenant context repo" or `<client>-vocion`). Core runs the platform; the context repo holds the work.

During early dev, a tenant's content typically lives alongside core in `context/<org>/` for convenience. When you're ready to split it out (phase C — OSS launch, or earlier for client separation), this doc walks through the extraction.

## What moves

A tenant context repo owns:

```
context/<org>/
├── context.yaml                # manifest — orgId, tenant name, retrieval overrides
├── sources/<slug>/source.yaml  # connector config (OAuth scope, filters, retrieval overrides)
├── objects/<slug>/type.yaml    # business object schemas
├── skills/<slug>/              # skill.yaml + prompt.md
├── workflows/<slug>/           # workflow.yaml (+ optional step prompts)
└── agents/<slug>.yaml          # + <slug>.system-prompt.md
```

Plus any tenant-specific docs (case studies, onboarding notes) if you want.

## What stays in core

Everything under `packages/core/` — the runtime, UI, plugin SDK, Postgres schema, MCP server. These are generic; they read whatever context you point them at.

## Portability contract

Core is tenant-agnostic by design. Points of contact:

| Signal | Default | Override |
|---|---|---|
| `CONTEXT_PATH` env var | `context/metacto` | Any path (absolute or relative) |
| `VOCION_ORG_NAME` env var | `metacto` | Your tenant slug |
| `VOCION_ORG_ID` env var | (from Clerk session) | Clerk org id for MCP or scripts |

No core code references `metacto` except as a default; change the env vars and everything re-points.

## Extraction recipe

Assumes tenant content today lives at `context/metacto/` in this repo.

### 1. Split the history

```bash
# From vocion-core repo root
git subtree split --prefix=context/metacto -b metacto-split
```

This creates a local branch `metacto-split` containing only the commits that touched `context/metacto/`, with that path reparented to the branch root.

### 2. Push to a new repo

```bash
# Create the new GitHub repo (private or public)
gh repo create vocion/metacto-vocion --private --description "MetaCTO tenant context for Vocion"

# Push the split branch as main
git push git@github.com:vocion/metacto-vocion.git metacto-split:main
```

### 3. Clone + layout the new repo

```bash
git clone git@github.com:vocion/metacto-vocion.git
cd metacto-vocion

# The split landed everything at root — no context/metacto/ prefix anymore.
# Optional: add a README + .gitignore + CI + a Vocion version pin.
```

Typical tenant repo layout after the split:

```
metacto-vocion/
├── README.md
├── context.yaml
├── sources/
├── objects/
├── skills/
├── workflows/
└── agents/
```

### 4. Point core at the new path

In the core install (local dev or production), update `.env.local`:

```bash
CONTEXT_PATH=/absolute/path/to/metacto-vocion
VOCION_ORG_NAME=metacto
```

Then:

```bash
npm run context:apply
```

Same behavior, content now version-controlled separately.

### 5. Clean up the core repo

```bash
# From vocion-core
git rm -r context/metacto
git commit -m "chore: extract metacto tenant to its own repo"
git push
```

The history of `context/metacto/` is preserved in both repos (core sees the delete, the tenant repo has the full prior history via `git subtree split`).

## Writing back from core to the tenant repo

The MCP `context_write_*` tools + the in-app Resource Editor both honor `CONTEXT_PATH`. They write to whatever directory you've pointed at, auto-commit with `chore(context): <summary>` in that repo, and call `context:apply` to sync the DB.

The tenant repo becomes the source of truth. Core is the runtime.

## Versioning + drift

- Tenant repo pins a compatible `@vocion/core` range in its `context.yaml`:
  ```yaml
  coreVersion: '>=0.1 <1.0'
  ```
- `context:apply` warns if the installed core is outside that range.
- Every `skill_run` stamps the active `context_sha`, so every output traces back to the tenant repo commit that produced it.

## Multiple tenants, one core install

Core is multi-tenant out of the box. To onboard a second tenant:

1. Create `<other>-vocion` repo (same layout).
2. Set `CONTEXT_PATH=/path/to/<other>-vocion` + `VOCION_ORG_NAME=<other>` + `VOCION_ORG_ID=<clerk-org-id>`.
3. `npm run context:apply` — each tenant's rows are scoped by `org_id` automatically.

Running two tenants from one process today means setting those env vars in the invoking shell (MCP session, cron, script). Per-request tenant switching (cloud-style) lands in Phase 3 v0.3.

## Related

- [`repo-architecture.md`](../reference/repo-architecture.md) — full layered model
- [`self-hosting.md`](./self-hosting.md) — install + env vars
- [`writing-a-plugin.md`](./writing-a-plugin.md) — plugin vs. tenant-context boundary
