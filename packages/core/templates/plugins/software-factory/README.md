# Software factory

A request — a bug report, a store review, a support email, a dogfood note, an
incident — becomes a **task contract**; a headless worker executes it in its
own checkout; the checks named in the contract decide whether it worked, with
the evidence attached; a person merges; the asker hears back. Nothing in that
sentence is new machinery — it is the record noun, the worker-run control
plane, the review queue and the trust ladder, pointed at changing code.

## The decision this plugin rests on

**The `engineering_task` object is the durable record a person looks at. The
`worker_run` underneath it is the execution lease.**

A task has a contract, a result, a request it came from and a history of
attempts; a run has a lease, a heartbeat, a budget and a `counts` map. They are
different lifetimes: a task picked up three times is still one task, and a task
nobody has started is still a task. Mapping the task onto the record noun we
already have (principle 7) is what makes most of this plugin free — the Factory
floor, the Backlog and the Product board are each an ordinary `archetype: list`
over `source: {kind: objects}`, and the Factory log is the same archetype over
the `workerRuns` source. No second history list, no new route.

## The nouns

Four object types, one intake door:

- **`request`** — the single intake noun. Every channel lands here as one
  object: `kind` (bug, gap, idea, incident, question), `channel`, `product`,
  the asker's own words, evidence as artifact ids, severity for bugs, a
  `decisionCost` in minutes, a `state` that ends in `shipped`, `answered` or a
  duplicate link, and a `dedupeKey`. Do not make a second type for a second
  channel.
- **`engineering_task`** — the contract and its result: `requestId` (the
  request record, required), `repoSlug` (the registry, required), `productSlug`,
  objective, allowed paths, acceptance criteria, `riskClass`, dependencies,
  budgets, attempt, required checks — and what comes back: branch, commit,
  PR URL, files changed, `verification` (each check with exit code, a one-line
  summary and the **artifact ids** that carry the proof), known failures,
  assumptions.
- **`repo`** — the registry a contract is written against: `checks` a worker
  may cite by name, `deployCommand`, `riskDefaults` (path glob → the lowest
  class a change touching it may carry), owners, product.
- **`product`** — name, working name versus launch name, stage, the incumbent
  with its dated and sourced list price beside ours, URLs, repositories, the
  accountable person, and the written **`promises`**.

## What turning it on adds

- **Task planner** (in-app): triages every request, turns the ones in scope
  into contracts with dependency edges and a risk class no lower than the
  repository's floor, promotes from the backlog only while the WIP limits
  allow, and never writes code.
- **Task engineer** (`harness.runsOn: external-worker`): asking it something
  queues a `worker_run` and returns a receipt; a process Vocion does not host
  claims the lease, heartbeats, reports cost, saves the proof of every check as
  an artifact and opens the pull request. It holds no merge authority.
- **Change reviewer** (in-app): reads the contract, the diff, the
  `verification` entries and the repository's `riskDefaults` — never the
  implementer's conversation — and returns approve, changes or reject keyed to
  a contract line. **Approves nothing without an artifact behind every check**,
  and rejects a contract whose class sits below its floor without reading the
  diff.
- **Three skills**: `triage-request`, `write-task-contract`,
  `review-against-contract`.
- **Four playbooks** — the narrative context read before writing anything, and
  the plugin's defaults a workspace overrides with its own facts:
  `the-twenty-percent`, `written-promises`, `verify-against-reality`, and
  `house-voice` (a stub; see below).
- **Seven standing missions**, each with its cadence: `close-the-gap` (the
  lead's promoter tick — no request waits more than a week), `no-open-p1`,
  `stand-up-product` (one product from brief to dogfood; the initiative WIP
  limit lives here), `keep-it-running` (weekly), `half-of-incumbent`
  (monthly read, daily reaction), `green-every-night` (nightly black-box e2e
  against production), `tell-the-requester` (every two hours, the reply back
  on the asker's channel). Plus two event-triggered intake automations: a
  request arriving and a check failing.
- **Trust rules** per risk class — see *Earned speed*.
- **Five rows in the plugin's own nav section, "Software factory"**: the
  **Backlog** (every open request, oldest first, by product), the **Factory
  floor** (every task, what is waiting on a person, what carries evidence),
  the **Product board** (stage, URLs, our price beside the incumbent's, who is
  accountable), the **Factory log** (every run — who, what kind, what it cost,
  what it said it did, the PR one tap away), and **Team report** (a link row
  seating the core spend report beside the log).
- The **software-factory** team, graded on tasks a person accepted, requests
  answered inside a week, pull requests opened (the worker's own count, shown
  as the weakest provenance) and worker spend; cost per accepted task is
  derived from the last two.

## The throttle — three WIP limits, metered by decision cost

The backlog is unbounded and cheap. The queue in front of a person is bounded
and expensive. The promoter between them is the `close-the-gap` mission tick,
which ranks open requests by value against the standing goals and the
products' promises and dispatches in that order until a limit is hit:

1. **Decision WIP is a budget of human minutes, not a count.** Every request
   and every task carries a `decisionCost` — the honest answer to a question,
   1; a docs merge, 1; a logic merge, 5; an architecture or pricing call, 60.
   The tick promotes only while the sum over open asks is under the day's
   budget, **60 minutes** to start. Ten merges is a coffee; ten architecture
   asks is a week, and a count would have called them the same.
2. **Execution WIP** is worker concurrency and per-agent spend, and core
   already holds it: the agent's period budget (`agent_budget`) and the
   per-run cap. Named, not rebuilt.
3. **Initiative WIP — at most one big thing in flight.** A new product, a
   major feature, a shared platform change. `stand-up-product` holds the limit;
   the planner's skill refuses to decompose a second initiative while one is
   open and raises it as an ask naming both.

**What the schema carries and what is convention.** `decisionCost` lives on
the `request` and `engineering_task` object schemas, which are free JSON
Schema, so it is a real field. Neither the mission schema nor the ask has a
budget or a WIP field, so the 60-minute budget and the initiative limit are
written into the missions' goals and success criteria and into the planner's
skill as convention the ledger is graded against. A `decisionCost` on the ask
itself and a mission-level budget are named as core follow-ups below.

## Earned speed

A merge is not one action kind — merging a docs change and merging a billing
change are different decisions — so `trust.yaml` carries one `git.merge.<riskClass>`
rule per class, each earning or never earning on its own ledger:

| Risk class | Starts at | Earns `execute-within-bounds` at | Tier in `trust.yaml` |
|---|---|---|---|
| `docs`, `deps` | approval | n ≥ 30 decisions, 95% agreement | `medium` |
| `marketing` | approval | n ≥ 50, 95% | `medium` |
| `ui` | approval | n ≥ 100, 97% | `medium` |
| `logic`, `auth`, `billing`, `schema`, `infra`, `promise` | approval | **never in 2027** | `high` |

`trust.yaml` can express a starting rung and a risk tier; the tier picks the
platform's evidence rule (`medium`: n ≥ 40 at 95%, ceiling
execute-within-bounds; `high`: never past approval). It **cannot** express a
per-rule n or agreement rate, so the thresholds above are the convention the
person who clicks promote grades the ledger against — stricter than the tier
for ui (do not promote `git.merge.ui` on the page's word alone), looser than it
for docs and deps (the page will say "not yet" ten decisions longer than the
convention would). A per-rule `minN` / `minAgreement` is the core follow-up.

**Permanent gates — never automated:** pricing and plan limits; the four
written promises (no AI tier; free seats never converted to paid; no
unrequested feature shipped and repriced around; the free plan never made
worse to upsell); credentials; schema migrations; production provisioning;
store submissions.

**Bugs are not on that list.** A P1 fix whose failing test now passes, with
the before and after as artifacts, is a good early autonomy candidate. What
makes a fix dangerous is the risk class of the files it touches — and
`repo.riskDefaults` decides that, not the word "bug".

## Mechanism, meaning, concretion

**Core ships the mechanism**: the record noun and its list archetype, the
`workerRuns` page source and the `link` row, the `worker_run` control plane
(claim, lease, heartbeat, checkpoint, complete, fail, cancel, budgets,
`counts`), the `external-worker` harness target, artifacts, asks, the review
queue, the trust ladder and the team report.

**This plugin ships the meaning**: the four nouns and what each field is for,
who triages, who writes a contract, who reviews it against the diff and the
evidence, the three WIP limits, what a push costs versus what each class of
merge costs, the seven standing responsibilities, and the five rows a person
watches it from.

**The workspace ships the concretion**, and it has to:

- **Repositories** — a `repo` record per repository the factory may touch,
  with its checks by name and its `riskDefaults`. No record, no task.
- **Products and their promises** — a `product` record each, with the four
  promises written in and the product's own added beside them, the incumbent's
  dated and sourced price, and the URLs a nightly e2e runs against.
- **`house-voice`** — the plugin ships a stub; replace it whole-file at
  `playbooks/house-voice/SKILL.md` with the workspace's own voice, its named
  antagonist and its cited prices.
- **The accountable person.** The team inherits `accountableUser:` from
  `workspace.yaml`; name one, or name a different one on the team with
  `extends: core`. A plugin cannot know who owns a merge in someone else's
  deployment, and the values do not allow it to be unowned.
- **Budgets** — `agent_budget` and the per-run cap; the daily decision budget
  if 60 minutes is wrong for you (`missions/close-the-gap.yaml`, by slug).
- **Intake** — what event says a request arrived (`request.created`, posted to
  `/api/v1/events` by the workspace's own form, poller or webhook) or a check
  failed. Core ships no adapter; override the two intake automations by slug.
- **The worker itself** — Vocion does not host it. A process holding a tenant
  token claims the run, heartbeats, saves artifacts and reports `counts`
  (`prsOpened`, `centsSpent`, `answeredWithinSevenDays` are the keys the team
  measures read).

**Customise it** in the workspace, never by editing the plugin: patch an agent
with `agents/<slug>.yaml` + `extends: core`, replace a skill or playbook
whole-file, replace any page by slug, or write a `trust.yaml` rule for the same
action to move a bar.

## What this deliberately does not include

- **An integrator.** Landing accepted changes in order, resolving conflicts
  between two accepted branches, keeping main green. The only role that would
  want write access to main; its own change, its own review.
- **A launcher.** Something has to start a worker for a `queued` run; today
  that is out of band.
- **Intake adapters.** Nothing here turns a store review or a mailbox into a
  `request.created` event.
- **Registered actions.** Core does not yet register `git.push_branch`,
  `git.merge.<class>`, `request.answer`, `deploy.release` or
  `credentials.write`; the trust rules set the bar and the autonomy page shows
  it, but a worker cannot propose them until core does.
- **Decision cost on the ask, and a budget on the mission.** Convention today
  (see *The throttle*); a `decisionCost` field on asks and a mission-level
  decision budget would let the promoter be enforced rather than described.
- **Per-rule earning thresholds** in `trust.yaml` (`minN`, `minAgreement`) —
  see *Earned speed*.
- **A median measure.** A `counts` key sums over its window, so "days from
  request to shipped" is authored as the flow count of requests answered
  within seven days; a percentile source is a core change.
- **A cross-type stat** — open requests per product on the Product board; the
  Backlog groups by product instead.
- **A run detail route.** The Factory log's rows open the activity stream
  filtered to workers; a page per run would let the log link straight to it.
