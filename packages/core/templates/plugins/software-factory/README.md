# Software factory

A named request becomes a **task contract**; a headless worker executes it in
its own checkout; the checks named in the contract decide whether it worked; a
person merges. Nothing in that sentence is new machinery — it is the worker-run
control plane, the object noun, the review queue and the trust ladder, pointed
at changing code.

## The decision this plugin rests on

**The `engineering_task` object is the durable record a person looks at. The
`worker_run` underneath it is the execution lease.**

A task has a contract, a result, a request it came from and a history of
attempts; a run has a lease, a heartbeat, a budget and a `counts` map. They are
different lifetimes: a task picked up three times is still one task, and a task
nobody has started is still a task. Mapping the task onto the record noun we
already have (principle 7) is what makes the rest of this plugin free — the
Factory floor is an ordinary `archetype: list` over
`source: {kind: objects, objectType: engineering_task}`, with no worker-run
page source, no second history list and no new route. The run stays what ADR
0004 made it: the thing that holds the lease.

## What turning it on adds

- The **`engineering_task`** object type: repo, base commit, objective, the id
  of the request that asked for it, acceptance criteria, allowed paths, risk
  class, dependencies, model policy, token and wall-clock budgets, attempt,
  required checks — and what comes back: branch, commit, pull request, files
  changed, each check with its exit code and artifact, the known failures and
  the assumptions the worker had to make.
- The **Task planner** (in-app): turns a brief or a named request into task
  contracts with dependency edges, and never writes code.
- The **Task engineer** (`harness.runsOn: external-worker`): asking it
  something does not run a turn in the app — it queues a `worker_run` and
  returns a receipt, and a process Vocion does not host claims the lease,
  heartbeats, reports cost and opens the pull request. It holds no merge
  authority, and everything with a side effect outside the repository goes
  through the same review queue as any other agent's proposal.
- The **Change reviewer** (in-app): reads the contract, the diff and the check
  output — deliberately not the implementer's conversation — and returns
  approve, changes or reject with every finding keyed to a contract line.
- Two skills: **`write-task-contract`** (what makes a contract executable and
  checkable, and why every task carries its request id) and
  **`review-against-contract`** (the review order, the three verdicts, and the
  rule that a disagreement with the implementer becomes an ask rather than a
  third opinion).
- Two standing missions: **close-the-gap** — no named request older than seven
  days without a shipped change or an honest written answer — and
  **no-open-p1**. Their cadences, plus one event-triggered entry showing the
  intake shape when a check fails.
- **`trust.yaml`**: pushing a branch runs on its own; the merge is
  approval-only and cannot be auto-approved; deploys and anything touching
  credentials stay asked.
- The **Factory floor** page: every task, what is waiting on a person, what was
  retried, and the pull request one move away.
- The **software-factory** team, graded on tasks a person accepted, requests
  answered inside a week, pull requests opened (the worker's own count, shown
  as the weakest provenance) and worker spend.

## Mechanism, meaning, concretion

**Core ships the mechanism**: the record noun and its page archetype, the
`worker_run` control plane (claim, lease, heartbeat, checkpoint, complete,
fail, cancel, budgets, `counts`), the `external-worker` harness target, the
review queue, the trust ladder and the team report.

**This plugin ships the meaning**: what a task contract holds, who writes one,
who reviews it against the diff, what a push costs versus what a merge costs,
and what the floor shows.

**The workspace ships the concretion**, and it has to:

- **Repositories and products** — which repos exist, which are in scope, what
  the required checks are called there. A task names a repo; the plugin cannot
  know yours.
- **The accountable person.** The team inherits the workspace default
  (`accountableUser:` in `workspace.yaml`); name one, or name a different one
  on the team with `extends: core`. A plugin cannot know who owns a merge in
  someone else's deployment, and the values do not allow it to be unowned.
- **Budgets** — the agent's period budget (`agent_budget`) and the per-run cap.
  The contract's `tokenBudget` and `wallClockBudget` are the task's share of
  those, not a second budget system.
- **Intake** — what event says a request arrived or a check failed. Core ships
  no CI adapter; `automations/factory-ci-failure.yaml` shows the shape and a
  workspace overrides it by slug with its own event name and filter.
- **The worker itself** — Vocion does not host it. A process holding a tenant
  token claims the run, heartbeats, and reports `counts` (`prsOpened`,
  `centsSpent`, `answeredWithinSevenDays` are the keys the team measures read).

**Customise it** in the workspace, never by editing the plugin: patch an agent
with `agents/<slug>.yaml` + `extends: core`, replace a skill whole-file at
`skills/<slug>/SKILL.md`, replace `pages/factory-floor.yaml` by slug, or write
a `trust.yaml` rule for the same action to move a bar.

## What this deliberately does not include

- **An integrator.** The agent that lands accepted changes in order, resolves
  conflicts between two accepted branches and keeps main green is a real
  fourth role, and it is the next one to write. It is left out because it is
  the only one of the four that would want write access to main, and that
  deserves its own change and its own review.
- **A launcher.** Something has to start a worker for a queued run. Today that
  is out of band — a schedule, an automation, CI, or a person.
- **Intake adapters.** No connector here turns a support thread or a CI webhook
  into a request.
- **A median measure.** "Days from request to shipped" is the figure this team
  most wants; a `counts` key sums over its window, so the measure authored here
  is the flow count of requests answered within seven days. A percentile or
  median measure source is a core change.
