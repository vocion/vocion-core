# Internal Docs

MetaCTO-specific planning, tracking, and case studies. **Not public** — these docs are for the MetaCTO team running CoreContext, not for OSS consumers.

If CoreContext goes public (Phase 8), this directory stays private (either excluded from the public website build or moved to a separate private repo).

## What lives here

| File | Purpose |
|---|---|
| [progress.md](./progress.md) | Running log of what's shipped, in flight, queued. Commit list, decision log, test + infra status. |
| [customer-onboarding.md](./customer-onboarding.md) | MetaCTO's build-up process for each new customer deployment |
| [managed-operations.md](./managed-operations.md) | MetaCTO's managed-ops service offering — recurring revenue model, tuning, evals, training |
| [case-studies/](./case-studies/README.md) | Per-customer agent specs — Ziggy (sales ops), Algren (NINJIO account manager), future customers |

## Public / external docs live elsewhere

- [`/README.md`](../../README.md) — product pitch + quick start
- [`/ROADMAP.md`](../../ROADMAP.md) — phased delivery plan
- [`/docs/`](../) — platform dev docs (MCP, plugins, workflows, self-hosted install)
- [`/requirements/`](../../requirements/README.md) — platform architecture, object model, RBAC, etc.
- [`/context/README.md`](../../context/README.md) — context-as-code authoring guide
