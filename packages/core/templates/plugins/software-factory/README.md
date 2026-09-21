# Software factory

A request — a bug report, a store review, a support email, a dogfood note, an
incident — becomes a **task contract**; a headless worker executes it in its
own checkout; the checks named in the contract decide whether it worked, with
the evidence attached; a person merges; the asker hears back. Nothing in that
sentence is new machinery — it is the record noun, the worker-run control
plane, the review queue and the trust ladder, pointed at changing code.

Five disciplines, one team: **Product** (the product manager — which ten
things, and why), **Architecture** (the task planner — the contract),
**Engineering** (the task engineer — the change), **QA** (the change reviewer
— the verdict) and **Design** (no agent yet; the seat is declared empty in
`teams/software-factory.yaml` rather than left missing). Each agent's `eyebrow`
names its discipline, because that is the one field every surface that shows a
tagline already renders.

## Two views, joined on `product`

The plugin puts two dashboards in the nav, and keeps them apart on purpose.

**AppCurious** — the portfolio, first in the nav — is the **outcome view**:
every product a person answers for, its stage and health, our price beside
the incumbent's dated list price, what shipped this month, what is still
owed, how fast a request becomes a release, and the **Releases** that reached
people. This is what the factory exists to move. Its numbers are read from
the `product` record or **agent-maintained** on it, and every column that is
maintained says so.

**Software factory** — the section underneath — is the **evidence**: the
Backlog, the Recommendations, the Factory floor, the Product board, the
Factory log and the Team report. Every figure on the portfolio can be traced one section down to the
requests, tasks, runs and spend it was computed from.

Outcomes people own on top, evidence you can reach underneath (values 1 and
3), joined on the one noun both sides carry: `product`.

### What the lead's tick maintains

A page's stats compute over their own rows, so "open requests per product"
cannot be a stat on a page whose rows are products. The counters live on the
`product` record instead — `openRequests`, `p1Open`, `shippedThisMonth`,
`medianDaysToShip`, `lastReleaseAt`, `health`, stamped `countersUpdatedAt` —
and the `keep-the-board-honest` mission recomputes them every morning from the
request and release records, naming the rows each came from. They are labelled
**agent-maintained** on the page and in the type, because that is their
provenance: the agent computed them, nothing independent confirmed them, and
they are dated so a stale one reads as stale. `revenueMonthCents` stays empty
until a verified Stripe source exists; the column is labelled "no source yet"
rather than showing a zero nobody measured.

### The release write path

A `release` is written by the thing that deployed — a script or the engineer —
over **`POST /api/v1/objects`** with `type: release` and
`externalKey: {system: deploy, id: <product>@<version>}`. Once the post-deploy
check has run, the same call again with `healthAfter` and the artifact ids
lands on the same row: the key is what makes a retried write one release, not
two. `tell-the-requester` then reads each release's `requestIds` against its
`announcedTo` and proposes the reply to everyone not yet told, on the channel
they used; the portfolio counts `releasedAt` for "shipped this month". A merge
nobody can find as a release did not ship.

### Release notes and the announcement

Releases are the unit of "what shipped", so the notes live on the release.
The **`write-release-notes`** skill drafts them from the tasks the release
carried and the requests it closed — never from the diff — naming what a
person can now do and citing the request that asked (`#<requestId>`), in the
house voice, with no internal task ids or model names. The draft is
`notesSource: agent`; **a person edits or approves it and it becomes
`notesSource: human`, after which the agent never writes it again** — AI
fills, human wins. The `announcement` is one or two public sentences written
only from owned notes, and releasing it is the **`release.announce`** action:
approval to start, the medium tier like marketing copy, earning its way to
running within bounds as people stop editing it. Telling each asker that their
request shipped is **`notify.requester`** — the same action as the honest "no"
— one reply per request on the channel they used. `tell-the-requester` puts a
release with notes and no announcement first in every pass. The **Changelog**
page (AppCurious) is the public-facing read of the same rows: the announcement
line per release, newest first; a field cannot render markdown, so the notes
are one tap on.

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

Five object types, one intake door:

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
  accountable person, the written **`promises`**, and the agent-maintained
  counters the portfolio reads (`health`, `openRequests`, `p1Open`,
  `shippedThisMonth`, `medianDaysToShip`, `lastReleaseAt`, `countersUpdatedAt`).
- **`release`** — one deploy that reached people: product, version,
  `releasedAt`, the deploy run, the commit, the PRs, the task and request ids
  it carried, `sizeClass` (the largest aboard), `healthAfter` with its
  artifacts, the release `notes` with `notesSource` (agent or human), the
  `announcement`, `announcedAt` and `announcedTo` (channels and requester ids).

`request` and `engineering_task` both carry a **`sizeClass`** — `major` (a new
capability or product; counts against the initiative limit), `minor` (a
feature within a product), `patch` (a fix) — in release terms, not effort.

## What turning it on adds

- **Product manager** (in-app, Product): audits the planner's tags and adds
  theme and ICP, ranks every product's backlog with the reasons on the
  request, puts at most ten recommendations in front of the accountable
  person and pauses until they are decided, files a weekly ideas pass as
  requests, and authorizes nothing — see *The product manager* below.
- **Task planner** (in-app, Architecture): triages every request, turns the ones in scope
  into contracts with dependency edges and a risk class no lower than the
  repository's floor, promotes from the backlog only while the WIP limits
  allow, and never writes code.
- **Task engineer** (`harness.runsOn: external-worker`, Engineering): asking it something
  queues a `worker_run` and returns a receipt; a process Vocion does not host
  claims the lease, heartbeats, reports cost, saves the proof of every check as
  an artifact and opens the pull request. It holds no merge authority.
- **Change reviewer** (in-app, QA): reads the contract, the diff, the
  `verification` entries and the repository's `riskDefaults` — never the
  implementer's conversation — and returns approve, changes or reject keyed to
  a contract line. **Approves nothing without an artifact behind every check**,
  and rejects a contract whose class sits below its floor without reading the
  diff.
- **Seven skills**: `triage-request`, `write-task-contract`,
  `review-against-contract`, `write-release-notes`, and the product manager's
  `rank-the-backlog`, `recommend-in-batches`, `ideate-from-evidence`.
- **Four playbooks** — the narrative context read before writing anything, and
  the plugin's defaults a workspace overrides with its own facts:
  `the-twenty-percent`, `written-promises`, `verify-against-reality`, and
  `house-voice` (a stub; see below).
- **Ten standing missions**, each with its cadence: `product-review` (the
  product manager's — weekly, with four automations underneath it),
  `product-debrief` (the product manager's other one — no cadence, checked
  the moment a worker run ends or a pull request merges),
  `keep-the-board-honest`
  (every morning, the portfolio's counters recomputed from the records), `close-the-gap` (the
  lead's promoter tick — no request waits more than a week), `no-open-p1`,
  `stand-up-product` (one product from brief to dogfood; the initiative WIP
  limit lives here), `keep-it-running` (weekly), `half-of-incumbent`
  (monthly read, daily reaction), `green-every-night` (nightly black-box e2e
  against production), `tell-the-requester` (every two hours, the reply back
  on the asker's channel, read from the releases). Plus two event-triggered intake automations: a
  request arriving and a check failing.
- **Initiative and routing.** The product manager declares `initiative: high`
  and what it `handles` (backlog, priorities, recommendations, requests,
  release notes), so the router sends those questions to it when nobody
  names an agent, it takes a routing tie, and it debriefs completed work; the
  planner is `normal` and handles plans, task contracts and triage. See
  [agent](../../../../../docs/entities/agent.md#behaviour).
- **Trust rules** per risk class — see *Earned speed*.
- **Three rows in the "AppCurious" section, first in the nav**: the
  **portfolio** (the outcome view above), **Releases** (what reached people,
  newest first, by product, with the post-deploy health and who owns the
  notes) and the **Changelog** (the announcement line per release, for the
  public's eyes).
- **Seven rows in the "Software factory" section underneath**: the
  **Backlog** (every open request, oldest first, by product, with its
  priority and when it was scored), the **Recommendations** (every request
  the product manager put in front of a person — the proposed outcome, the
  evidence, what they decided — by batch), the **Factory floor** (every
  task, what is waiting on a person, what carries evidence, and the cost
  strip — spent per week, estimated beside actual), the **Product board**
  (stage, URLs, our price beside the incumbent's, who is accountable),
  **Costs** (where the money went — every request's estimate, actual and
  variance, cumulative under each feature tag), the **Factory log** (every
  run — who, what kind, what it cost, what it said it did, its last heartbeat
  and lease, the PR one tap away), and **Team report** (a link row seating
  the core spend report beside the log). The floor and the log are live:
  they re-read themselves every 15 seconds while open, so work in flight is
  seen as it happens, not as of page load. Every row on the Backlog and the
  Factory floor also carries a **Report** action, which opens that request's
  **feature report** — see below.
- The **software-factory** team, graded on tasks a person accepted, requests
  answered inside a week, recommendations a person decided, pull requests
  opened (the worker's own count, shown as the weakest provenance) and worker
  spend; cost per accepted task is derived from the last two.

## The product manager

Three agents build what was asked for. None of them owned the question that
comes before it — *of everything asked for, which ten things, and why* — and a
backlog with no owner for that question is answered by whoever shouts. The
product manager owns it, and owns it the way the rest of the factory owns
things: on the record, in the open, with a person deciding.

**What it owns.**

- **Tagging and tracking.** Every request carries `product`, `kind`,
  `severity` where it applies, `theme` (the job it serves) and `icp` (who it
  is for), and every request that ended carries the task or release that
  ended it (`taskIds`, `releaseId`) or its `answer`. It **audits the
  planner's tags rather than redoing triage**: it corrects only what the
  request's own words contradict, and adds the two tags triage does not set.
- **Ranking.** Per product, against four inputs and nothing else — the
  product's written `promises`, the twenty-percent playbook, how many real
  people asked (duplicates count, comparison charts do not), and evidence
  from an analytics source **when a PostHog or Sentry source exists in the
  workspace**, cited with its date. The score and its reasons live on the
  request: `priority`, `priorityReason`, `rankedAt`. A score without a
  written reason is not written. (`rank-the-backlog`.)
- **Recommending.** The top of the ranking becomes **at most ten asks** of
  kind `recommendation` for the accountable person, sharing one `groupKey`
  so they are decided as one sheet on Needs you. Each names the request or
  requests, the proposed outcome — **build, answer, decline or merge** — the
  decision cost in minutes, and the evidence it rests on. On filing, the
  request gets `recommendedAt`, `recommendationBatch`, `recommendedOutcome`
  and `recommendationState: proposed`, which is what the Recommendations
  page reads. (`recommend-in-batches`.)
- **Ideating.** Once a week, from feedback in the asker's words, dogfood
  notes, the incumbent as the `product` record describes it, and analytics
  when a source exists: at most five ideas, each deduped against every open
  request, each written to name the job it serves and the evidence it rests
  on, filed as a `request` of `kind: idea` with `source: product-manager` —
  **never as a task**. An idea enters the same ranking as everyone else's
  request and is not built because the agent had it. (`ideate-from-evidence`.)

**The throttle — ten, then pause.** No second batch is assembled while one
ask of the first is undecided. When a decision lands (`product-batch-decided`
fires on `ask.decided`), it is written on the request — `recommendationState`,
`decidedAt`, the person's note as `decisionReason` — and routed: an approved
**build** sets `state: in_scope` and the planner's next tick writes the
contract; an approved **answer** or **decline** drafts the `answer` and hands
it to `tell-the-requester` to propose the reply; an approved **merge** sets
`duplicateOf`; a **rejection** leaves the request open with its reason and
**out of the next batch** — a person said no, and asking again next week is
nagging, not a new recommendation. When a batch is old, the daily check names
who it is waiting on and for how many days. The person is the bottleneck by
design, and the board says so in their name rather than routing around them.

**What it never does.** Write a task contract. Decide a merge. Change a price
or a promise. Tell an asker anything (that is a `notify.requester` proposal a
person releases). File an idea as a task. Put an eleventh ask in a batch.
Open a second batch while one is undecided. Rank on effort or on how
interesting the work is. **Authorize.** The person's answer to the ask *is*
the authorization; the agent recommends and reads the answer back.

**How, when and why it acts** is not in its prompt. It is five automations —
four `checkMission`s on `product-review` and one on `product-debrief` — each
with a `description` that says why in one sentence, each visible on
`/dashboard/automation` with its runs on `/dashboard/automation/runs`:

| Automation | When | Why |
|---|---|---|
| `product-tag-audit` | weekdays 11:30 UTC, after the board recompute | a backlog you cannot filter is one you cannot rank; a `shipped` request with no release is a claim nobody can trace. Scheduled, not on an event, because core raises no event when an object's state changes — the file says so |
| `product-weekly-review` | Mondays 14:00 UTC | re-rank, ideate, and — only if no batch is open — assemble the next ten |
| `product-recommendations-check` | weekdays 13:00 UTC | the pause is only a throttle if it is visible: names the person and the days when a batch is older than seven |
| `product-batch-decided` | `ask.decided`, filtered to this agent and kind `recommendation` | write the decision on the request and route it while it is fresh; assemble the next batch only when the last ask of the current one is decided |
| `product-debrief` | `worker_run.completed`, `worker_run.failed`, `pr.merged` — core's completion events | no request is answered by work its record does not know about: the request's state and what answered it, the actual cost beside the estimate, the recommendation refreshed with the outcome, draft release notes on the release if one exists (`product-debrief` mission). Authorizes nothing, announces nothing |

The prompt tells the agent it acts only when one of these fires or a person
asks it in chat. A workspace changes a cadence by overriding the automation by
slug; pausing one from the dashboard is a core follow-up (see below).
`product-debrief`, like every event automation, is never fired by an event its
own run raised and is held to `when.maxFiresPer10m` (default 6) fires in ten
minutes, the rest coalesced into one run; pause it over
`POST /api/v1/automations/product-debrief/pause` or `automation_pause` when it
must stop now ([automation](../../../../../docs/entities/automation.md#pausing-and-resuming)).

**Earned authorization.** `trust.yaml` carries `product.recommend` (rung
`recommend`, `low`: the recommendation is the ask, there is nothing for an
approval to release) and one `product.authorize.<class>` rule per class, on
the model of `git.merge.<class>`: `docs`, `copy` and `deps` are `low` and may
earn their way to running without a person — an approved-class recommendation
released to the planner without a click; `fix` and `feature` are `medium` and
stop at running within bounds; `major` and `promise` are `high` and never
earn it. Core does not yet register these actions, so today every class is a
person's answer; the rules set the bar and the autonomy page shows it.

## The feature report — one request, end to end

The records were always all there, and all linked. A feature that shipped
leaves a trail across seven of them: the `request` that asked for it, the
`engineering_task` that contracted it, every `worker_run` that attempted it,
the `ask` and `action_run` rows a person decided, the artifacts that prove it
works, and the `release` that carried it to people. Each has a page. None of
them had the story, so answering *what happened with this?* meant seven tabs
and a guess about who approved anything.

`pages/feature.yaml` is the answer: the `report` archetype over the `request`
noun, at **`/dashboard/p/feature/<requestId>`**, reached from the **Report**
action on any Backlog or Factory floor row. It is off the nav on purpose —
a report is about ONE request, so it is entered from a row, not from a list
of reports.

It opens with six figures — **asked, shipped, elapsed, total cost, human
decisions, attempts** — then a **vertical timeline, oldest first so the
newest entry is last**, each entry stamped with its time and, where money was
spent, its cost. Under it, nine sections in reading order:

| section | what it carries |
|---|---|
| The ask | the request in the asker's own words, who asked, when, through which channel, and any evidence they attached |
| Triage | kind, state, severity, size, risk floor, decision cost, priority and the twenty-percent verdict with its reason |
| The contract | per task: the objective, allowed paths, acceptance criteria, required checks, risk class and the estimate |
| Approvals | every `ask` and hand-off `action_run` tied to this work — who decided, when, and the note |
| The runs | every attempt: agent, attempt number, status, duration, cost, each check pass or fail, and on a failure the kept branch and draft pull request |
| The change | the pull request, its title, its checks, the merge commit and the files it touched |
| QA evidence | a gallery of the artifacts attached to the task, with captions |
| The release | the notes, the announcement, when it shipped and to which surface |
| Estimate against actual | the estimate, the actual, the variance both ways, and what the runs actually charged |

**Three rules, and they are the point of the page.**

1. **A stage that did not happen says so.** Every section renders. One with
   nothing in it carries a sentence naming the absence — *"No release carries
   this task"*, *"No task contract was written for this request; nothing was
   dispatched"*, *"No person approved this; it ran under earned autonomy"* (and,
   when nothing ran either, *"Nothing about this work was ever put in front of
   a person"*). The absence is the finding; hiding the section would hide it.
2. **No stage is inferred from another.** A merged pull request does not make
   a run successful. A shipped release does not make a task accepted. A
   passing check is not QA evidence.
3. **A contradiction is shown, not resolved.** A run recorded `failed` whose
   pull request merged is banded across the top with both facts and the
   reason they can both be true — the worker's completion call can time out
   after the pull request is already open. The same band carries a task
   rollup that disagrees with what the runs charged, an accepted task with no
   pull request, and a release carrying work no task accepted. Nothing on it
   is reconciled for you.

The whole thing reads in one column at 390px; a measured test holds it there.

### QA evidence — the slot, and the shape a worker must post

Nothing fills this slot today, which is exactly why it is not hidden: the
section says *"No QA evidence was captured for this task"* on every feature,
and that sentence is a finding about the factory.

Evidence is an ordinary core **artifact**, attached to the
`engineering_task` it proves:

```
recordType: 'object'                  # business objects are `object` records
recordId:   '<engineering_task id>'
recordRole: 'qa-screenshot' | 'qa-video' | 'qa-report'
kind:       'file' | 'link' | 'markdown'
title:      'Checkout, empty cart'    # the heading in the gallery
spec:       { url, filename, contentType, bytes }   # kind: file
            { href, title, description }            # kind: link
            { md }                                  # kind: markdown
```

`recordRole` carries the marker rather than `kind`, because `artifact.kind`
is a closed core enum and a worker cannot add `qa-screenshot` to it. A worker
that writes the marker into `spec.kind` instead is still read, so the
convention can tighten later without dropping evidence already posted. A
screenshot with a URL draws itself; a video or a report is a labelled link;
`spec.caption` is the line beneath it. Several artifacts may share a role —
a gallery is the point.

This is distinct from the task's `verification` entries, which are the
*merge* evidence a reviewer decides on. Verification proves a check ran; QA
evidence shows a person what the change looks like.

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

**The whole factory has one switch.** *Pause workspace* in the top bar stops
everything this plugin does by itself — every automation fire, every mission
run, every worker run queued or claimed, and every gated action that is not a
hand-off a person performs — in one click, with a note everyone else reads on
every page until it is lifted. Chat with an agent stays open, a worker already
mid-run finishes and reports, and automations someone paused individually stay
paused when the workspace resumes. `POST /api/v1/workspace/pause { note }` and
`workspace_pause` over MCP do the same from a terminal. See
[the off switch](../../../../../docs/entities/workspace-manifest.md#the-off-switch--pausing-the-whole-workspace).

## What it costs

Chris's ask, in his words: cost for feature and bug and release, individual
and cumulative by feature tag, historical and estimated. Every figure is in
**cents in storage and money on the page**, and every one is one of two
things.

**Estimated.** The planner writes `estimateCents` on the task with the
contract — from the size class, the risk class and the model policy. It is a
guess, kept when the actual lands so the two read side by side. A task
dispatched without one takes the run's per-run cap (`capCents`) as its
estimate when the run ends: the ceiling standing in for a guess, and labelled
as an estimate all the same, so read it as "no more than".

**Measured.** Every worker run reports `cents` on its heartbeats — the
model's own bill, as the worker read it. When a run **ends** (complete, or
fail — a failed attempt still cost money), core sums `cents` over every run
queued for the same record and writes the sum onto that record as
`actualCents`, with `costUpdatedAt`, and `varianceCents` (actual minus
estimate) when both halves exist. A task picked up three times is charged
for three runs, once: the figure is recomputed from the rows, never
incremented, so a retried call lands the same number.

**The link is `input.record`.** The write-back reaches a task only when the
run was queued *for* it: whoever creates the run — the launcher, or
`POST /api/v1/worker-runs` — passes `input: {record: {type: engineering_task,
id: <task id>}, …}`. A run without a record charges the agent's budget as it
always did and lands on nothing. This is the one thing the workspace's
launcher has to do for any of this page to fill; the Factory log shows spend
per run either way.

**Where the roll-up runs.** A request's cost is the sum over its tasks; a
release's is the sum over the tasks it shipped. A page's stats compute over
their own rows, so neither can be a page stat — and a figure a person reads
on the record itself has to be *on* the record. So the roll-up is
**materialised**: `objects/request/type.yaml` and `objects/release/type.yaml`
each declare `rollups:` (which field, summed from which child type, linked
how — the task's `requestId` pointing at the request; the release's `taskIds`
listing its tasks), and core recomputes every rollup that reaches a task in
the same moment it writes that task's actual, from all of the parent's
children, stamping `rollupsUpdatedAt`. The mechanism is core's
(`services/objects/rollups.ts`, declared per `RollupSchema`); what rolls up
to what is this plugin's. Two consequences worth knowing: a release recorded
*after* its tasks' runs all ended shows no figure until one of those tasks
changes again — record the release, then let the last task's run end, or
accept the gap; and a task whose `requestId` is edited leaves the old
request's figure stale until one of *its* remaining tasks changes.

**Cumulative by feature tag.** `request.tags` is free strings. The **Costs**
page groups by it, and a request with two tags sits under both — "what has
search cost" and "what has billing cost" both want the request that touched
both — with the total under each group the cumulative spend on everything
that carried the tag. The stats on top count each request once: total spent,
total estimated, spent this month (requests whose cost last moved this month
— a long feature is counted in the month its latest run ended), the average
cost of a feature (`gap` or `idea`) against the average cost of a bug.

**Historical.** The Factory floor carries a cost strip: spent per week for
the last eight weeks, estimated beside actual, each task counted in the week
its last run ended. The Backlog and Releases pages carry estimate and actual
columns with totals under each product.

**What a person can trust it for.** The actual is the worker's own report of
its bill, summed — the same provenance as the Factory log's cost column and
the team report's spend, no better. It is complete for runs that ended and
were queued with a record; a run reaped `lost` and never re-claimed is on the
log but on no task. The estimate is the planner's, or a cap. Neither is a
price a customer paid or a person's time; the decision budget on the Backlog
is the human cost, in minutes, and revenue stays on the portfolio with no
source until one exists. The right use is comparison — this feature against
that one, this month against last, a tag's cumulative spend against what it
earns — and the wrong use is invoicing.

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

**Core ships the mechanism**: the record noun and its list archetype (with
its `sum` stats, `money` format, column totals, tag grouping and the
`series` strip), the `workerRuns` page source and the `link` row,
`POST /api/v1/objects` (create or upsert an object by its external key, so a
deploy can record a release), the `worker_run` control plane (claim, lease,
heartbeat, checkpoint, complete, fail, cancel, budgets, `counts`, and the
cost write-back onto the record a run was queued for), object-type
`rollups`, the `external-worker` harness target, artifacts, asks, the review
queue, the trust ladder and the team report.

**This plugin ships the meaning**: the four nouns and what each field is for,
who tags and ranks and recommends, who triages, who writes a contract, who
reviews it against the diff and the evidence, the three WIP limits and the
ten-then-pause rule, what a push costs versus what each class of merge or
authorization costs, what rolls up onto a request and a release and from
where, the nine standing responsibilities, and the seven rows a person
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
  measures read). Whatever queues the run for a task passes
  `input.record: {type: engineering_task, id}` so the run's cost lands on the
  task when it ends (*What it costs*).

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
- **CI events — done, in core.** The `github` source (`docs/guides/github.md`) emits `pr.checks_completed` (with `conclusion` and the failed check names), `pr.review_submitted`, `pr.merged` and `run.failed` on the deploy branch, polled or by webhook; a workspace points `factory-ci-failure` at `pr.checks_completed` / `conclusion: failure` instead of the placeholder event.
- **Registered actions — done, in core.** `git.push_branch`, `git.merge`
  (one id; `riskClass` in the input picks the `git.merge.<class>` rule and
  ledger), `deploy.release`, `deploy.provision`, `aws.mutate`,
  `credentials.write`, `release.announce` and `notify.requester` are
  registered as hand-off actions (`libs/actions/factory.ts`): a worker
  proposes them with a headline, the steps (`say` / `run` / `url`), the
  cost, the target account and named sources, a person approves them,
  whoever does the work marks them done. What remains is plugin-owned
  registration, so these descriptors can move into this directory.
- **Decision cost on the ask, and a budget on the mission.** Convention today
  (see *The throttle*); a `decisionCost` field on asks and a mission-level
  decision budget would let the promoter be enforced rather than described.
- **Per-rule earning thresholds** in `trust.yaml` (`minN`, `minAgreement`) —
  see *Earned speed*.
- **A median measure.** A `counts` key sums over its window, so "days from
  request to shipped" is authored as the flow count of requests answered
  within seven days; a percentile source is a core change.
- **A cross-type stat** — open requests per product on the Product board; the
  Backlog groups by product instead. The `rollups` mechanism that sums a
  request's cost from its tasks could carry that count too (`product` ←
  `request.product`, no `sum`), which would make `openRequests` observed
  rather than agent-maintained; it is not wired yet.
- **An estimate the planner writes.** `estimateCents` is on the task schema
  and the roll-up reads it, but `write-task-contract` does not yet tell the
  planner to fill it; until it does, the run's cap stands in and the estimate
  column reads "no more than".
- **Cost on a lost run.** A run reaped `lost` and never re-claimed spent
  money that is on the log and on no task.
- **A run detail route.** The Factory log's rows open the activity stream
  filtered to workers; a page per run would let the log link straight to it.
- **A verified revenue source.** `revenueMonthCents` is empty until a Stripe
  connector can read it as `verified`; the portfolio labels the column "no
  source yet" and the board mission does not write it.
- **Cross-type page stats.** The agent-maintained counters exist because a
  page cannot count another type's rows; a page stat that reads `objects`
  of a second type keyed on a field would make `openRequests` observed
  rather than agent-maintained.
- **A Design agent, and an end-to-end QA agent.** The Design seat is declared
  empty in the team file; nothing reads a request for what it should look
  like before the planner writes what it should do. `green-every-night` asks
  for a nightly black-box e2e with screenshots and no agent owns running it —
  the reviewer grades the diff against the contract, not the product against
  the screen. Both are their own change.
- **A discipline field.** Neither the team nor the agent schema has one
  (`role` is the deprecated lead/specialist flag), and the org chart and the
  team report roster render an agent's name and icon only — so the
  discipline rides in each agent's `eyebrow` and the team's description. A
  `discipline` rendered on `/dashboard/teams` and the Team report roster is
  the core follow-up.
- **An in-app way to file an ask or write an object.** Asks are filed over
  `POST /api/v1/asks` and objects over `POST /api/v1/objects`; no agent tool
  wraps either, so an in-app agent's recommendation batch and its writes on
  the request (`priority`, `recommendationState`, …) are the plugin's meaning
  until core ships `file_ask` and an object-write tool. The `ask.decided`
  event the batch automation subscribes to does exist (this release adds it
  to core); the ask it waits for has to be filed from outside today.
- **A `request.triaged` event.** Core raises no event when an object's state
  changes, so the tag audit runs daily rather than on triage.
- **A criteria verdict on a mission check.** A check's run is `ok` when it
  ran and `error` when it crashed; there is no "the criteria are not met", so
  `product-recommendations-check` cannot turn its card red when a batch is
  seven days old — it writes the failure in its report and the Recommendations
  page counts what is waiting.
- **Pausing an automation from the dashboard.** `/dashboard/automation` shows
  every automation and its runs and can test-run one; it cannot pause or edit
  one — that is `status: disabled` in the file and an apply. Named here so the
  gap is filed, not built into this plugin.
- **Registered `product.*` actions.** The eight factory ids above are
  registered hand-off actions (`libs/actions/factory.ts`); `product.recommend`
  and `product.authorize.<class>` are not yet. The trust rules set their bar
  and the autonomy page shows it, and nothing can propose them until core
  registers them the same way.
