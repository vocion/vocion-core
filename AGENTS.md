# AGENTS.md

Instructions for a coding agent working in this repository, or asked to stand Vocion up for a
company. Humans should start at [`README.md`](./README.md) and
[`docs/getting-started.md`](./docs/getting-started.md).

## What this repository is

Vocion is an open-source agent workforce platform: a Next.js app, a Postgres schema, an MCP
server, and a workflow runner, shipped as `@vocion/core` under MPL-2.0. You author the whole
workforce — agents, teams, skills, playbooks, missions, workflows, automations, object types,
sources, trust rules — as YAML and markdown in a git-backed **workspace** directory that lives
*outside* this checkout, apply it to the database, and run it with a human review queue, audit
rows on every apply, and observability attached.

## Facts to get right before you write anything

- `@vocion/core` is `"private": true` and is **not published to npm**. There is no
  `npm install @vocion/core`. You install Vocion by cloning this repository.
- The repository is an npm workspaces monorepo. Root `package.json` name is `vocion`;
  `workspaces` = `packages/core`, `packages/sdk`, `packages/agent-runtime`, `packages/plugins/*`.
- `engines.node` is `>=20`. Use Node 20 or newer, with npm (there is no pnpm or yarn lockfile).
- Almost every root script delegates into a workspace
  (`npm run dev --workspace @vocion/core`). Prefer the root script; it exists for a reason.
- Root scripts that take arguments already end in `--`
  (`workspace:scaffold`, `workspace:apply`, `workspace:check`, `tokens:*`), so you pass args as
  `npm run workspace:apply -- <path> --project <id>`.
- Configuration lives in the workspace, not in TypeScript. If you are tempted to hardcode a
  prompt, an agent, or a skill into a source file, you are in the wrong place: it belongs in the
  workspace directory.

## Setup — the exact sequence

Every command below exists in `package.json` at the repository root. Run them from the root of
the checkout.

```bash
# 1. Clone and install
git clone https://github.com/vocion/vocion-core.git
cd vocion-core
npm install

# 2. Configure environment (never commit the result; .env* is gitignored)
cp packages/core/.env.example packages/core/.env.local
# Fill in at least: the database URL, the auth secret, and one LLM provider key.
# A workspace can later store its own provider keys, which take precedence over these.

# 3. Start local services: app Postgres (pgvector) plus the platform stack
#    (Langfuse on :3200, Temporal on :7233 with its UI on :8233, OTel collector on :4317/:4318)
npm run dev:up
npm run dev:status          # docker compose ps
# npm run dev:down          # stop it again

# 4. Apply the database schema
npm run db:migrate

# 5. Scaffold a workspace — created at ../workspace/<name>, a peer of this checkout
npm run workspace:scaffold -- acme-revenue
#   options: --path <dir>   (default ../workspace/<name>)

# 6. Validate it, then apply it to the database
export WORKSPACE_PATH=../workspace/acme-revenue
npm run workspace:check -- ../workspace/acme-revenue
npm run workspace:apply -- ../workspace/acme-revenue --project <project-id-or-slug>

# 7. Run the app against the running services
npm run dev:next            # Next.js only, against the Postgres from step 3
# npm run dev               # alternative: embedded PGLite database + Next.js + Spotlight
# → http://localhost:3000
```

`npm run workspace:check` is `workspace:apply --dry-run`: it validates and diffs without writing.
Run it before every apply. Each apply writes a `workspace_version` audit row, and every
`tool_call` is stamped with the `workspace_sha`, so any output traces back to the exact authored
files that produced it.

### Serving MCP

```bash
# Local, stdio, single-tenant — for an IDE or a coding agent on this machine
npm run mcp:serve
# entrypoint: packages/core/src/interfaces/mcp/bin.ts

# Register with Claude Code
claude mcp add vocion -- npm --prefix /abs/path/to/vocion-core run mcp:serve
```

Remote MCP is HTTP: `POST /api/mcp` (`packages/core/src/app/api/mcp/route.ts`) with a tenant
Bearer token, `Authorization: Bearer vcn_live_...`. Mint tokens with the CLI:

```bash
npm run tokens:issue -- --org <id-or-slug> --name <label> [--role <role>] [--expires-in-days <n>]
npm run tokens:list   -- --org <id-or-slug>
npm run tokens:revoke -- --org <id-or-slug> --id <tokenId>
```

## Where the entities live

Two locations matter, and they are different things.

**1. Authored entities — the workspace, outside this repo** (`$WORKSPACE_PATH`, by convention
`../workspace/<org>/`). This is what you edit when a company asks for a new agent, skill, or
approval gate:

| Entity | File in the workspace | Reference doc |
|---|---|---|
| Workspace manifest | `workspace.yaml` | [`docs/entities/workspace-manifest.md`](./docs/entities/workspace-manifest.md) |
| Agent | `agents/<slug>.yaml` + `agents/<slug>.system-prompt.md` | [`docs/entities/agent.md`](./docs/entities/agent.md) |
| Team | `teams/<slug>.yaml` | [`docs/entities/team.md`](./docs/entities/team.md) |
| Skill | `skills/<slug>/SKILL.md` | [`docs/entities/skill.md`](./docs/entities/skill.md) |
| Playbook | `playbooks/<slug>/SKILL.md` | [`docs/entities/playbook.md`](./docs/entities/playbook.md) |
| Mission | `missions/<slug>.yaml` | [`docs/entities/mission.md`](./docs/entities/mission.md) |
| Workflow | `workflows/<slug>/workflow.yaml` | [`docs/entities/workflow.md`](./docs/entities/workflow.md) |
| Automation | `automations/<slug>.yaml` | [`docs/entities/automation.md`](./docs/entities/automation.md) |
| Object type | `objects/<slug>/type.yaml` | [`docs/entities/object-type.md`](./docs/entities/object-type.md) |
| Source | `sources/<slug>.yaml` | [`docs/entities/source.md`](./docs/entities/source.md) |
| Trust rules | `trust.yaml` | [`docs/entities/trust.md`](./docs/entities/trust.md) |
| Learning step | `learnings/<name>.yaml` | [`docs/entities/learning-step.md`](./docs/entities/learning-step.md) |
| Eval dataset | `evals/<slug>.yaml` | [`docs/entities/eval-dataset.md`](./docs/entities/eval-dataset.md) |
| Workspace page | `pages/<slug>.yaml` | [`docs/workspace-pages.md`](./docs/workspace-pages.md) |

**2. Code in this repository:**

| What | Path |
|---|---|
| App, schema, MCP, workflow runner | `packages/core/` |
| Drizzle schema | `packages/core/src/models/Schema.ts` |
| SQL migrations | `packages/core/migrations/` |
| Workspace loader and apply | `packages/core/src/libs/workspace/` |
| CLI scripts behind every `npm run …` | `packages/core/src/scripts/` |
| MCP server (stdio) | `packages/core/src/interfaces/mcp/` |
| MCP over HTTP | `packages/core/src/app/api/mcp/route.ts` |
| Write API (reviews, runs, agents, …) | `packages/core/src/app/api/v1/` |
| Agent services, tools, tenant claims | `packages/core/src/services/agents/` |
| Source connectors | `packages/core/src/libs/sources/` |
| Base pack shipped inside core | `packages/core/templates/base/` (`pack.yaml`, `agents/`, `skills/`, `playbooks/`) |
| Workspace templates | `packages/core/templates/workspaces/` |
| Plugin contract | `packages/sdk/` (`@vocion/sdk`) |
| Reference plugin | `packages/plugins/transcript-highlights/` |
| Standalone agent runtime (bring your own agent) | `packages/agent-runtime/` |
| Local and platform compose files | `docker-compose.yml`, `infra/docker-compose.platform.yml` |
| Public docs | `docs/` |

### Adding an agent

Create `agents/<slug>.yaml` plus `agents/<slug>.system-prompt.md` in the workspace, run
`npm run workspace:check -- <path>`, then `npm run workspace:apply -- <path> --project <id>`.
Field-by-field rules are in [`docs/entities/agent.md`](./docs/entities/agent.md). Seven default
agents already ship in the base pack at `packages/core/templates/base/agents/`; pin the pack with
`extends: core@<version>` in `workspace.yaml` and activate the ones you want with `use:` rather
than copying them — see [`docs/entities/base-pack.md`](./docs/entities/base-pack.md).

### Adding a skill

Create `skills/<slug>/SKILL.md` in the workspace: frontmatter plus a markdown procedure the model
reads on its own judgement. Set `requiresApproval: true` in the frontmatter when a person must
sign off before the skill's action lands. See [`docs/entities/skill.md`](./docs/entities/skill.md)
and the worked examples in `packages/core/templates/base/skills/`.

A skill that needs real code instead of a procedure is a **plugin**: a package exporting a
`PluginManifest` built with `defineSkill` from `@vocion/sdk`. Copy the shape from
`packages/plugins/transcript-highlights/`.

### Adding an approval gate

There are three mechanisms. Pick by scope.

1. **Per workflow step** — add an approve or ask gate to a step in
   `workflows/<slug>/workflow.yaml`. Deterministic, scoped to one procedure.
   See [`docs/entities/workflow.md`](./docs/entities/workflow.md).
2. **Per skill** — `requiresApproval` in the skill's frontmatter. Applies wherever the skill runs.
3. **Per action class** — `trust.yaml` declares which actions may auto-execute and above what
   confidence. See [`docs/entities/trust.md`](./docs/entities/trust.md).

Missions carry an `autonomyPolicy.level` from 1 to 5 (1 draft only, 2 ask before acting, 3 act
within rules, 4 manage a goal, 5 improve itself) —
[`docs/entities/mission.md`](./docs/entities/mission.md).

Everything gated lands in one review queue, readable and decidable over HTTP:
`GET /api/v1/reviews` and `POST /api/v1/reviews/decide`
(`packages/core/src/app/api/v1/reviews/`).

## Verify: lint, types, tests

```bash
npm run lint             # eslint . (Antfu config) — run before every commit
npm run lint:fix         # eslint . --fix
npm run check:types      # tsc --noEmit in @vocion/core; strict mode
npm test                 # vitest run
npm run test:e2e         # playwright; needs the app and services running
npm run check:deps       # knip — unused dependencies and exports
npm run check:i18n       # translation completeness for src/locales
npm run check:integrity  # scripts/check-config-integrity.mjs
npm run build            # migrations + next build + docs search index
```

The lefthook `pre-commit` hook runs integrity, eslint `--fix` on staged files, `check:types`, and
`check:deps`, in that order; `commit-msg` runs commitlint. Expect a commit to take a while, and
expect knip to fail your commit if you add a dependency or an export that nothing imports yet.

Where to look when something breaks: the Next.js dev server output in your terminal, Langfuse at
`http://localhost:3200` for LLM traces and cost, the Temporal UI at `http://localhost:8233` for
workflow and schedule state, `docker compose logs -f postgres` for the database, and
OpenTelemetry spans through the collector on `:4317`/`:4318`. Application logging is LogTape.

## Conventions you must follow

- **Conventional Commits**, enforced by commitlint and lefthook: `feat:`, `fix:`, `docs:`,
  `refactor:`, `test:`, `chore:`. Release versions are computed from commit types, so use `docs:`
  for documentation-only changes.
- **Sign off every commit**: `git commit -s` (DCO 1.1). See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  for the inbound license grant you accept by contributing.
- **Branch and open a pull request.** Do not commit to `main`, do not merge your own pull request,
  do not publish anything to npm.
- **TypeScript strict**, ESLint with the Antfu config. Fix lint rather than disabling a rule.
- **Structural over prompting.** If a behavior is a requirement, enforce it with a typed contract
  or deterministic post-processing, not by rewording a system prompt.
- **Never cache an LLM client across organizations.** Provider keys resolve per organization, and
  a per-provider singleton hands the first org's key to every org after it.
- **Schema changes**: edit `packages/core/src/models/Schema.ts`, then run `npm run db:generate`
  followed by `npm run db:migrate`. Never hand-edit a migration that has already shipped.
- **Multi-tenancy is a query concern**, not a prompt concern. Scope by organization at the data
  layer; never rely on instructions to keep tenants apart.
- Translations live in `packages/core/src/locales/`; maintain `en.json` and leave the rest to
  Crowdin.

## Do not touch

- `docs/internal/**` and `requirements/**` — internal working notes, roadmaps, incident
  write-ups, and named case studies. Never quote them in public docs, a README, an article, or a
  pull request body.
- `.env`, `.env.local`, any `.env*` file, `.npmrc`, and anything under `~/.ssh` or `~/.aws`.
  Read `packages/core/.env.example` for the *shape* of the configuration; never read or print a
  filled-in env file, and never commit one.
- Generated output: shipped SQL in `packages/core/migrations/`, `.next/`, `out/`, `coverage/`,
  `packages/core/public/pagefind/`, `packages/agent-runtime/dist/`, `storybook-static/`,
  `playwright-report/`, and `package-lock.json` (let npm write it).
- `infra/terraform/**` state files and `.tfvars`. Generating a plan is fine; changing live
  infrastructure is a human decision.
- `LICENSE`, `COMMERCIAL-LICENSE.md`, and the trademark language in `README.md`.
- Customer or prospect names anywhere in public content.

## Getting more detail

- [`docs/getting-started.md`](./docs/getting-started.md) — zero to a working workforce, one
  entity type at a time.
- [`docs/workspace.md`](./docs/workspace.md) — workspace-as-code: create, author, apply, base
  packs.
- [`docs/object-model.md`](./docs/object-model.md) — where each object is authored, stored,
  executed, and displayed.
- [`docs/README.md`](./docs/README.md) — docs index.
- <https://www.vocion.ai/docs> — the hosted documentation.
