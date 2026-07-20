# F1 usage tour — Teams + Workspace Lead

`teams-workspace-lead.tour.spec.ts` walks design.md's 8-shot storyboard as
one cinematic Playwright spec with `video: 'on'` (the `tour` project in
`playwright.config.ts`). It is **self-seeding**: it needs a *fresh* database
(zero users), signs up the first-run admin ("Chris Fitkin" — he becomes the
workspace-default owner), and loads the bundled Meridian Outdoor sample from
the Teams empty state. Shot 7 only asserts the seeded composer pre-fill —
**no message is ever sent**, so no model key or agent runtime is needed.

## Command sequence (PGlite, one command)

From `packages/core`. The Playwright `webServer` boots a fresh **in-memory
PGlite** on :5432 (migrations auto-apply) plus `next dev` on :3008 — exactly
the fresh-DB state shot 1 needs.

```bash
# 1. Ports must be free: :5432 (stop the umbrella docker Postgres and any
#    stray pglite-server) and :3008.
lsof -ti :5432,:3008          # should print nothing; otherwise stop what holds them
# (umbrella repo: `docker compose down` keeps the pgdata volume)

# 2. Env — next dev validates these at boot. If packages/core/.env.local
#    already exists (bootstrap-generated) its DATABASE_URL must point at
#    127.0.0.1:5432; otherwise pass them inline:
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vocion
export AUTH_SECRET=tour-only-secret

# 3. Optional — lets team detail's "under the hood" show the bundle's YAML
#    files panel (the spec passes either way; the slug row is the assertion):
export WORKSPACE_PATH=packages/core/templates/workspaces/meridian-revenue

# 4. Run the tour (webServer starts + stops the DB/server around it):
npx playwright test --project=tour
```

## Against a dev server you started yourself

`reuseExistingServer` is on outside CI — if :3008 already answers, Playwright
uses it. The DB behind it must be **fresh** (the spec fails fast on the
sign-up shot with a clear message if any user exists):

```bash
# terminal 1 — fresh in-memory PGlite + app on :3008 (env from above):
PORT=3008 npx run-p db-server:memory dev:next --race

# terminal 2:
npx playwright test --project=tour
```

To re-run, restart terminal 1 first — in-memory PGlite resets on restart.
(With `db-server:file` instead, delete `local.db*` to reset.)

The spec navigates **client-side** (sidebar links, cards) everywhere
after the initial sign-up load, on purpose: a `page.goto` while the dev
server is still streaming/hydrating can leave the destination's content
parked in a hidden streaming template for 15–30s, which surfaces as a
"resolved to 2 elements, both hidden" strict-mode timeout. If you add
shots, follow the same pattern — navigate by clicking, gate with an
assertion.

## Output

One `.webm` per run under `test-results/**/video.webm` (~45–60s; the
storyboard starts after the ~5s sign-up prologue). Copy it to
`deliverables/f1-teams-workspace-lead/` in the umbrella repo alongside
screenshots.

## Shots (design.md §5)

1. Fresh workspace → `/dashboard/teams` empty state
2. "Load the sample revenue workspace" → confirm → org chart populates
3. Hold on the org chart; cursor traces lead band → four team cards
4. Owner provenance: Marketing's explicit "Lili Chen" vs inherited
   "Chris Fitkin (workspace default)" + tooltip
5. RevOps team detail; pause on "what runs free / what waits"
6. Back → workspace-lead band → "Ask how the quarter is going"
7. Chat opens with the seeded "How's the quarter going?" **pre-fill only**
   (no live model — the composer pre-fill is the shot)
8. Under-the-hood reveal (slug + YAML, demoted), collapse, close on org chart
