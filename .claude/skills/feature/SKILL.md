---
name: feature
description: Deliver a major feature end-to-end across the Vocion repos — deep multi-step plan, build in core (code + UI/UX), update the marketing site + docs, increment semver, and ship a blog/release-notes post. Use for substantial work that touches both vocion-core and vocion-www (and sometimes firsthq), needs a real plan, and ends in a release. Delegates the docs/blog/changelog/version propagation to the `/release` skill.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash(git *)
  - Bash(gh *)
  - Bash(npm run *)
  - Bash(npx eslint *)
  - Bash(npx vitest *)
  - Bash(vercel *)
---

# Feature

This skill takes a **major feature** from idea to shipped, across the Vocion repos, without dropping
any of the surfaces that make a feature "real": code, app UX, docs, marketing, version, and release
notes. It's the bigger sibling of `/release` (which only propagates an already-built unit of work).

Repos in play (the umbrella `vocion-local` pins them):
- **vocion-core** — the framework: code, dashboard UI, schema/migrations, MCP, the runtime, semver.
- **vocion-www** — public docs + marketing site + blog/`/changelog`.
- **firsthq** (when buyer-facing) — product roadmap + marketing narrative.

## The four phases

### 1. Deep plan
Don't start coding. First understand and decide.
- Explore both repos (read the real files; use the patterns in `references/build-core-primitive.md`).
- Write a plan. Pin scope with the user where it's unbounded: **what to build now vs. plan for
  later phases**, the FirstHQ scope, and the release posture. (This is the planning loop the
  Missions feature used.)
- Identify what to **reuse** before proposing anything new — Vocion already has agents, runtime,
  subagents, write_todos, HITL, learnings, budgets, workflows, the workspace audit stamp.

### 2. Build core + UI
Use the add-a-primitive checklist (`references/build-core-primitive.md`):
schema → migration → service + runtime → oRPC router → MCP tools → workspace authoring → dashboard
UI + sidebar → i18n → tests. Verify continuously: `npm run check:types`, `npx eslint --fix` on new
files, `npx vitest run` on new tests. Commit on a branch.

### 3. Marketing + docs
- vocion-www: a concept doc in `docs/features/`, a how-to in `docs/guides/`, MCP rows in
  `reference/mcp.md`, links from `docs/README.md`.
- firsthq (if buyer-facing): update `ROADMAP.md` + `docs/product-plan.md` and the marketing site
  narrative.

### 4. Semver + release
Hand off to **`/release`** (`references/cross-repo-release.md`): conventional commits, branch → PR →
merge per repo, re-pin the umbrella submodules, manual `vercel --prod` for vocion-www, and the
blog/`/changelog`/internal-changelog. A plain `feat:` bumps the minor; only use `!`/`BREAKING
CHANGE:` when you intend a major.

## Core principles
1. **Plan deeply, then build.** Unbounded scope gets pinned with the user before code.
2. **Reuse first.** New primitives extend the existing runtime; they don't fork it.
3. **Every surface or it's not shipped.** Code without docs/UX/marketing/version is half a feature.
4. **Verify as you go.** Typecheck + lint + tests green before each commit; never push red on purpose.
5. **One framework, modes/envelopes — not new species.** Prefer a new mode/parameter over a parallel system.

## Don't
- Don't skip the plan + scope questions for a large feature.
- Don't push to a repo's `main` until typecheck + lint + tests pass.
- Don't forget the umbrella re-pin and the (currently manual) vocion-www deploy.
- See `references/cross-repo-release.md` for the known carryover blockers (CI env, auto-deploy, drizzle generate).
