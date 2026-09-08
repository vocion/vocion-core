# Larkfield Systems — Support (starter workspace template)

A second starter workspace, shaped around the thing most teams are
actually nervous about: letting an agent talk to a customer or move
money. Larkfield Systems is fictional — a mid-market B2B scheduling
product sold to field-service companies. Every number here is sample
flavor and lives only in prompts, descriptions, and the sample corpus
under `data/`.

Where `meridian-revenue` shows the *org shape* (a workspace lead
consulting team leads), this one shows the **human-in-the-loop shape**:
two workflows whose middle step is an `approve` gate, a trust ladder
that ships entirely disabled, a standing mission pinned at autonomy
level 1, and two read-only agents that cannot propose anything at all.

## Shape

- **Workspace lead:** `support-director` (`lead:` in `workspace.yaml`).
- **Three teams, flat:** Frontline (teal), Escalations (amber), Service
  Quality (violet). Each has a lead plus specialists; specialists are one
  level deep via `parent:`.
- **Eight agents.** `reply-drafter` and `credit-desk` write things a
  customer would see and are gated. `ticket-triage` and `csat-analyst`
  are read-only by construction — `harness.excludeTools: [propose_action]`
  withholds the proposal tool so it never reaches their catalog.
- **Four skills**, all `skills/<slug>/SKILL.md`: `triage-ticket`,
  `draft-ticket-reply`, `recommend-credit`, `queue-health-report`.
- **Two sources**, both `kind: local-files`, so the workspace is useful
  with zero credentials: `helpdesk` (8 sample tickets) and `handbook`
  (SLA table, credit policy, escalation path with three known defects).
- **One learning step**, `support_replies`, seeded with the six rules a
  reviewer keeps writing in the reject box.

## What the approve gate holds

Two workflows, in `workflows/<slug>/workflow.yaml`:

| Workflow | The gate | What it holds back |
|---|---|---|
| `ticket-reply-approval` | `review-reply` (`type: approve`, `reviews: reply-draft`) | The reply itself. `sync` refreshes both sources first so nobody is told to retry a workaround they already reported failing; the `action` step (`gmail.send`) runs only after a person approves. |
| `credit-approval` | `approve-amount` (`type: approve`, `reviews: recommendation`) | The money. The Credit Desk sizes the credit and writes the case; the `action` step (`hubspot.update`) records it on the account only after a human takes the decision. |

Both `ask` steps carry a `default:` (`{{input.draft}}` /
`{{input.recommendation}}`), so the same definition serves an automated
caller that already has the text and a person starting the run by hand —
an ask that already has its answer does not ask.

Three more places the same boundary shows up:

- **`trust.yaml`** — the autonomy ladder. `hubspot.update` at 0.95 and
  `gmail.send` at 0.99, both `enabled: false`. The workspace starts at
  "a human sees everything"; a person raises one action at a time, and
  everything that later auto-approves still lands in the review queue's
  auto-executed list.
- **`missions/keep-the-queue-clear.yaml`** — `autonomyPolicy.level: 1`,
  the floor of the ladder, with success criteria that include "nothing
  sits in the review queue longer than one business day".
- **`agents/*.yaml`** — `harness.interrupts: [propose_action]` on the two
  writing agents; `harness.excludeTools: [propose_action]` on the two
  read-only ones. Gate what should pause, withhold what should never
  exist.

`automations/queue-sweep.yaml` is the only place time lives: a weekday
cron that checks the standing mission. Missions stay pure goals,
workflows stay pure procedures.

## Loading it

`workspace:check` makes no database writes, but it does connect — so a
reachable, migrated `DATABASE_URL` has to exist first. Migrate, then
check, then apply:

```bash
npm run db:migrate
npm run workspace:check -- packages/core/templates/workspaces/larkfield-support
npm run workspace:apply -- packages/core/templates/workspaces/larkfield-support --project <id|slug>
```

Two notes on a manual apply:

- `workspace.yaml` deliberately omits `accountableUser`, so no team
  resolves an owner and the loader warns about it. Add
  `accountableUser: <your email>` before applying if you want the three
  teams to inherit a real person.
- The `local-files` sources resolve `directory:` relative to
  `WORKSPACE_PATH` (or absolute). Copy this directory to your workspace
  root — or set `WORKSPACE_PATH` to it — so `data/tickets` and
  `data/handbook` resolve, then sync from `/dashboard/connectors` or with
  `npm run sync:source`.

## Sample data

`data/tickets/` — eight tickets across the priority range: a P2 timezone
defect and its reopen, a double-booking dispatch bug, two credit requests
($4,200 downtime, $2,200 integration outage), an Android session bug, a
reminder-time question, and an SSO request. Frontmatter carries id,
account, plan, priority, status, and product area; the `local-files`
connector parses it into document metadata.

`data/handbook/` — the three documents a reply has to be grounded in
before a reviewer will approve it: the SLA table, the credit policy with
its 10%/20% caps, and the escalation path with the known-defect table.

## Related

`../meridian-revenue/` — the revenue-shaped starter.
[`docs/entities/workflow.md`](../../../../../docs/entities/workflow.md) ·
[`docs/entities/trust.md`](../../../../../docs/entities/trust.md) ·
[`docs/entities/mission.md`](../../../../../docs/entities/mission.md)
