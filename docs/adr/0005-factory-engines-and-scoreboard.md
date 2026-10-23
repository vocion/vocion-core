# ADR 0005 — Factory engines: defaults, the scoreboard, the router, rollback

- **Status:** accepted 2026-10-22
- **Date:** 2026-10-22
- **Owners:** Jamie Schiesel (decision to ship without an eval gate); the Software Factory
- **Related:** ADR 0004 (external workers), `docs/guides/runner.md` (engines),
  `packages/runner/src/engines/`, `packages/runner/eval/`, `services/factory/engineRouter.ts`,
  `services/factory/engineRun.ts`, migration `0213_engine_run.sql`

## Context

The factory's engineer seat ran one engine, headless Claude Code (`claude-cli`). The runner now
has an engine registry and a second engine, OpenHands (MIT, self-hosted, any model through
LiteLLM), behind the same contract, guard hooks, checks, budget and cost reporting (#1381).

The owner's direction (2026-10-22): no eval gate before rollout; put a consistent scoreboard in
place; routing by task complexity or model cost comes later; optimise for getting it into use.
The eval harness stays as a reference, not a gate.

This ADR records the decisions, reviewed through four lenses: runtime (the runner), data (the
scoreboard), platform (images and deploys) and security (guards and credentials).

## Decisions

### 1. Which engine is the default where

| Where | Engine | How it is set |
|---|---|---|
| Core's default, every workspace that says nothing | `claude-cli` | the runner's default; the contract omits `engine` |
| Metacto's DeliveryStack workspace | `openhands` | `harness: {engine: openhands}` on its `task-engineer` seat (an `extends: core` patch) |
| A client installation | `openhands` only | `VOCION_ALLOWED_ENGINES=openhands` and the `open` runner image |

Why: DeliveryStack is our own, its factory pull requests land on `dev` (the repo record's
`defaultBranch` becomes the contract's `base_branch`), and a person still merges. That is the
smallest blast radius that still puts OpenHands on real work every day. Everything else stays on
the engine it has today, so a bad night costs one workspace. Clients get open engines only; the
fence enforces it at dispatch, whatever a seat says.

The published runner image carries both engines (`internal` builds `FROM open`): an
installation's runners claim across every workspace, so any runner must be able to take any run.
A runner that claims an engine its image lacks fails the run before cloning or calling a model.

### 2. The scoreboard: one row per engineering run (`engine_run`)

Every factory run whose input carries a task contract gets one row, in one shape whichever
engine did it:

- **Who and what:** engine, model, seat, route policy and reason, task id, request (feature) id,
  repo, base branch, risk class.
- **Time and money:** started, ended, duration; input, output and cache-read tokens; cents (the
  worker's final account, the same figure `featureSpend.ts` sums).
- **Quality:** pull request, checks passed of total, QA's verdict, accepted, merged, reverted, and
  one `outcome` word (`running`, `failed`, `cancelled`, `no_pr`, `pr_opened`, `qa_failed`,
  `qa_passed`, `accepted`, `rejected`, `merged`, `reverted`, `superseded`).
- **Effort and safety:** attempt number and the retries the task took after it; guard
  violations (tool calls the guard hooks refused, every pass summed).
- **Complexity hint:** files touched, lines added and removed, and a `small` / `medium` / `large`
  bucket.

A row is **derived, not reported**: `syncEngineRuns` reads the worker_run and the engineering task
it built, and upserts. It runs when a run ends (`completeWorkerRun`, `failWorkerRun`) and before
the board is read, so an outcome that arrives later (QA, the merge, a revert) is on the board
without any other code knowing the board exists. It is idempotent and self-healing: a missed
hook is corrected by the next read. We chose this over subscribing to each event (verdict, merge,
revert) because there is one place to get right, and it cannot drift from the records.

Eval runs are imported in the same shape (`source: eval`, `src/scripts/import-eval-runs.ts`),
the grader standing in for QA, so eval and real work read side by side but never mix.

Read it at `GET /api/v1/engine-runs/scoreboard?days=30&source=factory` (one line per engine:
runs, PR rate, QA pass rate, acceptance rate, median duration, spend, cost per landed change,
guard violations, retries, by complexity) and `GET /api/v1/engine-runs` (the rows).

### 3. Routing: static now, a chain with room for dynamic policies

`routeEngine(features)` asks a chain of policies; the first with an opinion wins. Today the chain
is one policy, `static`: the task's own engine, else the seat's `harness.engine`, else the
default. The features every policy gets are facts at dispatch: seat, task and seat engines, risk
class, repo, planned paths, a complexity bucket and the task's budget (`estimatedCents`).

The hook for dynamic routing: a policy that reads complexity or estimated cost (and, later, the
scoreboard's own figures) goes in front of `static` in `ROUTE_POLICIES` and passes on what it has
no opinion about. The answer is the contract's `engine`; which policy chose it, and why, rides the
run's input as `route` and lands on the scoreboard row, so each policy's results can be compared.

The installation's fence (`VOCION_ALLOWED_ENGINES`) is applied after the chain, so no policy can
route a client to an engine it does not allow.

Deferred, deliberately: weighted / canary splits, shadow and best-of-N builds, the workspace
`factory:` YAML block, proposed promotions and demotions, and a scoreboard page in the app.
Each is additive to what is here.

### 4. Rollback

- **One workspace:** remove the `harness.engine` patch from its `task-engineer` (or set
  `claude-cli`) in the agents repo and apply. The next dispatch uses it; a run in flight finishes
  on its own engine.
- **An installation:** `VOCION_ALLOWED_ENGINES=claude-cli` routes every run back to the default.
- **The code:** revert the PRs. The migration only adds a table; with the code reverted nothing
  writes or reads it.
- **The image:** pin the Fargate task definition's `runner_image` back to the previous `sha-` tag.

### 5. Security

Both engines run under the same guard scripts (`guard-bash.sh`, `guard-write.sh`), the same
human-owned paths and the same required checks. OpenHands' hook fails closed on an unknown tool
or an unreadable call. The OpenHands driver removes every credential from its environment before
any tool starts. Models are reached with the runner's existing key until the Bedrock task role
lands (an infra change, made by a person with AWS access). Guard refusals are counted on every
row, so a rise in one engine's violations is visible the day it happens.

## Consequences

- OpenHands builds DeliveryStack's tasks from the day this ships; the board says how it does,
  next to `claude-cli` everywhere else and the eval baselines.
- The scoreboard is the evidence for every later routing decision, including the dynamic one.
- A person still merges every change; nothing here promotes an engine on its own.
