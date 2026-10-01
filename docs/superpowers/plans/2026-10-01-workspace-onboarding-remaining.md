# Workspace onboarding (#1028): what is left to finish this branch

Written 2026-10-01, when the branch was handed from a Claude Code session to the
software factory. Read this first, then the plan it continues:
[`2026-10-01-workspace-onboarding.md`](./2026-10-01-workspace-onboarding.md).
The spec is issue [vocion/vocion-core#1028](https://github.com/vocion/vocion-core/issues/1028).
The plan's **Global Constraints** apply to every item below.

- **Branch:** `feat/issue-1028-workspace-onboarding`, cut from `main` at `687e6df3`.
  `main` has moved since, so rebase before the PR.
- **Why this file exists:** the run's ledger (`.superpowers/sdd/…/progress.md`) is
  git-ignored and does not travel with the branch. Everything in it that is still
  open is copied here.

## Where it stands

| Plan task | State |
|---|---|
| 1–9 | Done and reviewed. Commits `a9f573fc` to `4b47b38c`. |
| 10 Scripted e2e | The spec is committed (`8fc382f9`). Its review asked for three fixes, and those are committed in this handoff, **but the e2e suites have not been run since the fixes**. See step 1. |
| Backfill for migration 0161 | Done in this handoff, with `src/models/projectOnboardingMigration.test.ts` (2/2 passing). See "Decisions already made". |
| 11 Gates, diff read, PR | Not started. |

## Steps, in order

### 1. Prove the task 10 fixes

The review of `8fc382f9` found three things, and the fixes are now in the branch:

- The spec raced its own sign-in redirect. Signing in goes `/dashboard` to
  `/dashboard/chat`, which opens setup by itself, so the spec now waits for that
  instead of navigating.
- The "opens only once" check was `toHaveCount(0)` on text, which passes even if a
  second setup conversation opened. It now lists conversations and expects
  exactly one.
- The `chat-incomplete` and `documents` seeds left `onboarding_started_at` null,
  so the auto-start navigated their admin away. Both seeds now run
  `e2e/support/onboarding-db.ts mark-started`. `ChatShell` also uses
  `window.location.replace`, so Back skips the bare chat page.

Run all three scripted suites, each on a **fresh** database (setup opens once per
workspace, so a reused database has nothing left to open):

```bash
cd packages/core
npm run e2e:onboarding
npm run e2e:chat-incomplete
npm run e2e:documents
```

Expected: every test passes.

The "opens once" check gives a wrongly fired start call room to land with
`page.waitForTimeout(2000)`, and lint warns on that line
(`playwright/no-wait-for-timeout`). Replace the fixed wait with something that
waits on an event, such as expecting a `waitForRequest` on
`/rpc/onboarding/start` to time out. If you keep the wait, say why in the spec.

CI runs these through Playwright's `webServer`. On a
machine where host port 5432 is taken by another Postgres, run the servers by hand
instead, with only CI's throwaway values: `pglite-server --extensions=vector
--port=55439 --run 'npm run db:migrate'`, then `next dev -p 3008` with
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/postgres`, the
`webServer.env` values from `playwright.config.ts`, the suite's `VOCION_LLM_*`
and `WORKSPACE_PATH` values from its `package.json` script, and
`PLAYWRIGHT_SKIP_WEB_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3008` on the
test run. Restart `pglite-server` between suites.

### 2. Fixes the task reviews deferred to the end

Each one ships with a test that fails before the fix and passes after it.

1. **`safeReturnPath` lets encoded dot segments through**
   (`src/libs/connect/returnTo.ts`). `/dashboard/%2e%2e/login` passes the check,
   and the browser resolves it outside `/dashboard`. It stays on the same site, so
   it is not an open redirect, but it breaks the rule that `returnTo` stays inside
   the dashboard. Reject `%2e` in any case, or compare the URL-normalised pathname.
   Add the case beside the existing crafted-`returnTo` tests.
2. **The connect card never shows its "why"**
   (`src/services/agents/tools/offerConnection.ts`). The card sets
   `body: input.why`, but the client reads `rationale` for live cards and drops
   `body` from history, so the reason the agent gave is never shown. Map the "why"
   to `rationale` for link cards. The test asserts that the reason renders, both
   live and after a reload of the conversation.
3. **A crafted link can pre-fill any text in the composer**
   (`connectReturnPrompt` in `src/libs/connect/returnTo.ts`, fed from
   `app/[locale]/(auth)/dashboard/chat/page.tsx`). The raw `reason` query value
   goes into the pre-filled message. It is never sent by itself, but a person could
   press Send on text someone else wrote. Inside `connectReturnPrompt`, keep only
   `[\w.-]` and cap it at 64 characters.
4. **Changelog order in `templates/plugins/software-factory/plugin.yaml`.** The
   2.46.0 entry sits above 2.45.0. The file runs oldest first, with the newest
   entry last, just above `version:`.
5. **A vendor named in a skill**
   (`templates/plugins/software-factory/skills/products-from-repos/SKILL.md`, line 14).
   It says `github`. The plugin's 2.43.0 changelog says no skill names a vendor, so
   say "the connected code host".
6. **Check, then fix if needed: "Open record" hidden too widely**
   (`src/features/dashboard/chat/RecommendedActionCard.tsx`, the `recordLink`
   condition `rec.href && rec.actionId`). It hides "Open record" on every card that
   has an `href` but no action, not only on link cards. Find the other producers of
   action-less cards with an `href`. If any of them should still show the link,
   restrict the condition to `kind === 'link'` and pin it with a test.

The smaller ones below are optional. Fix them if they are cheap, or list them in
the PR:

- `src/features/dashboard/chat/onboardingStart.ts` logs `(err as Error).message`
  in its catch, and that is `undefined` when something other than an `Error` is
  thrown.
- `SourcesPanel` does not check `?add=` against the connector list, so a mistyped
  link opens an "Add <kind> source" form for a connector that does not exist.
- Step 5 of the `products-from-repos` skill says "when a product is accepted", but
  no signal tells the agent when that happens.
- There is no UI test for the `ChatShell` `onboardingDue` effect (one start call
  when due, none when not). Only the e2e covers it.
- There is no test that a link card's `href` survives a reload of the
  conversation.

### 3. Plan task 11: gates, diff read, PR

Follow the plan's Task 11 exactly. Paste the output of every gate into the PR:
`check:types`, `lint`, `check:deps`, `check:migrations`, `vitest run`, the
chat UI vitest project, and the three e2e suites from step 1. Name any test that
was skipped or failed. The PR body also carries:

- the plan's "Deviations from the issue" list
- the backfill decision below
- the separate `POST /rpc/sources` admin gap, filed as its own issue
- QA steps and one line on what was not verified (the real OAuth round trip
  against GitHub)

Post the PR link on #1028.

## Decisions already made (do not reopen without a reason)

- **The backfill lives in migration 0161, not in a new 0162.** 0161 has never
  shipped, and putting the backfill there keeps one file per change. It marks every
  workspace that exists at deploy time as started, so RevOps, the factories and
  Veerio do not pop a setup conversation after the deploy. "Onboard this
  workspace" still works in those workspaces.
- **The backfill runs only in the step that adds the column.** It sits inside a
  `DO $$` block guarded by "the column does not exist yet". `infra/aws/migrate.sh`
  replays every `.sql` on every deploy, so a plain `UPDATE … WHERE … IS NULL`
  would mark each new workspace as started before anyone opened it. The second
  test in `projectOnboardingMigration.test.ts` pins this.
- **Backfilled rows carry `onboarding_started_by = 'backfill:0161'`**, so a report
  on time to first connected source can leave them out.

## After this branch merges

The trial on the Veerio instance (a new workspace on `dev.agents.veerio.app`)
needs a published core tag: Veerio's `deploy.yml` refuses any other pin. So the
order is: merge, release, bump Veerio's pin on its `dev` branch, then walk through
first visit, describe, connect GitHub, return to the conversation, and the
product cards.
