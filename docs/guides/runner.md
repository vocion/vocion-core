# The runner: how an engineering task gets built

The runner is the process that builds a factory task. It claims a queued `worker_run`, clones
the repository, starts the services the tests need, runs headless Claude Code under the guard
hooks, runs the repository's checks, and then opens a pull request. When the run stops short, it
keeps the work on a draft pull request instead. It captures QA evidence (before and after
screenshots) for a change a person can see, and writes its state onto the task record. It lives
in `packages/runner` and ships as one container image.

The runner is the mechanism. It names no product. What a repository needs arrives in the task
contract, which the dispatch (`libs/actions/factory-dispatch.ts`) fills from the repo record and
the product's environments. A new repository builds once its repo record says how.

## The contract

`packages/runner/contract/schema.json` is the shape, and the runner and core both check against
it. Core's `factory-dispatch.runnerContract.test.ts` validates a dispatched contract with the
runner's own validator. The fields a repository supplies:

| Contract field | From | What the runner does with it |
|---|---|---|
| `required_checks` | the repo record's `checks` (names) | runs each after the engineer exits; any failure fails the run and keeps the work |
| `checks` | the repo record's `checks` that carry a `command` | runs that command exactly. Built-ins (`no-em-dashes`, `typecheck`, `test`, `lint`, `build`) need none |
| `environment.services` | the repo record's `services` | waits for each (`postgres`, at its `url`), exports the url, runs its `setup` (migrations) |
| `environment.setup` | the repo record's `setup` | runs after install, before the engineer starts |
| `human_owned` | the repo record's `humanOwned` | paths the engineer may not change and the runner never commits, beside secrets, `.git` and CI workflows |
| `engineer_rules` | the repo record's `engineerRules` | appended to the engineer's standing rules |
| `qa.surface`, `qa.surfaces` | the repo record's `qaSurface` and `surfaces`, plus the product's production environments | the before shot loads the surface's live URL; the after shot builds the branch with `build.command`, serves `build.dist`, and uses `build.signed_in_env` (the repo's preview mode) for a flow that needs an account |

`allowed_paths` is the plan's scope, not a fence. A file beyond it is kept and named on the pull
request. The only wall is what a person owns.

## A repo record the runner can build

```yaml
title: Acme/northwind-portal
url: https://github.com/Acme/northwind-portal
checks:
  - {name: test, command: npm test -- --run}
  - {name: typecheck}
qaSurface: app
surfaces:
  app:
    environment: web # the product environment whose URL is the live surface
    build:
      command: npm run build -w @northwind/web
      dist: apps/web/dist
      spaFallback: true
      env: {VITE_API_URL: https://api.northwind.example}
      signedInEnv: {VITE_MOCK_API: '1'} # the repo's own preview mode, so no credential leaks
    listRoutes: [/library]
    errorText: [Nothing at this address]
    previewNote: The preview answers from apps/web/src/mock; add a state there in the same change.
services:
  - {name: postgres, url: postgresql://runner:runner@localhost:5432/portal, setup: [npm run db:migrate -w @northwind/api]}
humanOwned: [infra/secrets/**]
engineerRules: [Short declaratives, plain nouns.]
```

## The image

`.github/workflows/runner-image.yml` builds the image on every change to `packages/runner`. On a
pull request it builds for linux/amd64 and proves the image starts, reports its version, and
carries its modules, hooks, schema and a working chromium. On `main` it pushes
`ghcr.io/vocion/vocion-runner:sha-<commit>` and `:main` for linux/amd64 and linux/arm64. A target
pins the `sha-` tag of the core commit its installation runs, so the runner moves when the core
pin moves, never on its own. The image reports that commit as `workerVersion` on every claim and
heartbeat.

## Engines

The engineering pass is the only part of a run that depends on the engine. A contract names one in
its optional `engine` block (`{ "id": "openhands" }`); without it the runner uses `claude-cli`,
exactly as before the field existed. `packages/runner/src/engines/` holds the registry:

| Engine | What runs | Image |
|---|---|---|
| `claude-cli` (default) | headless Claude Code, the arguments the runner always passed | the default (`internal`) target |
| `openhands` | the OpenHands Software Agent SDK (MIT), through `openhands_driver.py` | both targets: `internal` (what CI publishes) and `docker build --target open` (no Claude Code) |

The published (`internal`) image carries both engines. An installation's runners claim across
every workspace, oldest run first, so every runner must be able to take every run: a runner that
claims an engine its image lacks fails the run. The `open` target, with no Claude Code, is the
image for an installation that allows only open engines.

### Picking the engine for a workspace

The factory sends the engineer seat's engine. A workspace sets it with an `extends: core` patch on
`task-engineer`, beside the model:

```yaml
extends: core
slug: task-engineer
harness:
  engine: openhands            # claude-cli (the default) | openhands
  # engineModel: bedrock/us.anthropic.claude-opus-5-5   # optional; else anthropic/<harness.model>
```

`seatEngine` puts it on each contract as `engine` (a task's own `engine` wins). `claude-cli` with no
`engineModel` is never written, so a contract without a chosen engine is exactly what it was. The
repo record's `defaultBranch`, when it is not `main`, goes on the contract as `base_branch` (and
`base_sha` defaults to `origin/<that branch>`), so the work starts from and lands on that branch.

Everything else is the runner's and the same for every engine: the contract, the guard hooks and
the files a person owns, the required checks, the budget and wall clock, cost and usage on the
heartbeat, verify, land, keep and the kept-branch retry. An engine is a process that reads the
brief on stdin and prints Claude Code's stream-json, so the events, the transcript and the cost
come from the same reader. A runner refuses, before the clone, an engine its image does not carry.

### OpenHands

The SDK runs in the runner container, not as an agent-server sidecar. The container is already
the sandbox (one task, non-root, credentials stripped). A sidecar would add a shared volume, a
localhost port, session keys and a second image to pin, and no isolation the container lacks. The
open image installs `openhands-sdk` and `openhands-tools` from the pinned
`packages/runner/openhands-requirements.txt`, with no browser tool (and so no `browser-use` or
`posthog`) and no agent-server. The driver turns off Laminar and LiteLLM telemetry.

The guard is the runner's own. OpenHands runs `hooks/openhands-guard.sh` as a PreToolUse hook on
every tool call (exit 2 blocks, as in Claude Code), and the hook hands the call to the same scripts:

| OpenHands call | Checked by | Blocks |
|---|---|---|
| `terminal` | `guard-bash.sh` | git push, commit, merge, rebase and friends; GitHub writes; destructive commands; reading env files, keys and credential stores; dumping or naming credential variables; AWS writes, deploys and publishing; outbound writes; shell writes outside the repository |
| `file_editor` create, str_replace, insert, undo_edit | `guard-write.sh` | secrets and env files, `.git`, CI workflows, the repository's `human_owned`, anything outside the repository |
| `file_editor` view | the read denials in `claude-settings.json` | `.env*`, `*.pem`, `*.key`, `.ssh`, `.aws`, `.netrc`, `.npmrc`, `.git-credentials`, gh config |
| `task_tracker`, `finish`, `think` | allowed | |
| anything else | blocked | the hook fails closed, because OpenHands treats any exit but 2 as allow |

The final-diff check in verify (no file a person owns) is the backstop for both engines. The model
key is read once and removed from the driver's environment before any tool starts, so the agent's
shell holds no credentials at all.

**Model.** LiteLLM ids. A contract model such as `claude-opus-5-5` becomes
`anthropic/claude-opus-5-5` with `ANTHROPIC_API_KEY`. For production on Bedrock, set
`OPENHANDS_PROVIDER=bedrock` (and `OPENHANDS_BEDROCK_PREFIX`, for example `us.anthropic.`), or put
the full id in the contract (`engine.model: "bedrock/<inference profile id>"`). The runner then
keeps the task role's credentials for the driver only; the driver resolves them with boto3, hands
them to LiteLLM and drops them before any tool runs. The task role needs `bedrock:InvokeModel*` on
the allowed models.

**Known gaps.**
- A hook that times out (30 s) is not a block in OpenHands. The guard scripts take milliseconds;
  verify still refuses a change to a file a person owns.
- On Fargate the task role's metadata endpoint is reachable from the agent's shell, as it is for
  any process in the task. A LiteLLM proxy outside the task would remove that.
- There is no WebFetch tool (claude-cli allows a few documentation domains); the agent can still
  read the web with curl, under the same outbound-write rules.
- `model_policy.escalate_to` (claude-cli's fallback model) has no OpenHands equivalent yet.

### Where a resumed run lands

`base_branch` (optional, default `main`) is the branch the work lands on: a resumed branch is
rebased on it, its kept work is folded back against it, and the pull request targets it.

## Where it runs: the installation's targets

Runners are installation config, not workspace config. An installation declares its targets once,
in `VOCION_RUNNERS` (JSON) or the file `VOCION_RUNNERS_FILE` names (`libs/runners/config.ts`).
Every workspace on it builds on them with nothing to set up. With nothing declared, it has the
on-box target alone.

```json
{
  "targets": [
    {
      "name": "aws-fargate",
      "kind": "aws-fargate",
      "region": "us-east-1",
      "cluster": "vocion-runners",
      "taskDefinition": "vocion-runner",
      "taskDefinitionWithDb": "vocion-runner-db",
      "subnets": ["subnet-…"],
      "securityGroups": ["sg-…"]
    },
    { "name": "on-box", "kind": "on-box" }
  ]
}
```

| Target | How the container starts | When it claims |
|---|---|---|
| `on-box` | the `vocion-runner` service in the box's compose (`infra/aws/docker-compose.prod.yml`), looping, one run at a time, capped at `RUNNER_CPUS` (1) and `RUNNER_MEMORY` (4g), with its own throwaway `vocion-runner-db` | a run that has waited `RUNNER_CLAIM_AFTER` (120 s) unclaimed; 0 makes it primary where there is no cloud target |
| `aws-fargate` | a task in the installation's AWS account, provisioned by the instance's own IaC. Vocion starts one per run when the run is queued (`services/runners/targets.ts`, on the app's own AWS credentials: `ecs:RunTask` on the runner task definitions and `iam:PassRole` on their roles), and the instance's scheduled poll starts one more every minute as the fallback | at once (`RUNNER_CLAIM_AFTER=0`); the poll takes what waited a minute |

Every start is written on the run's progress, where the Runs page reads it: the target and task
it started, or why it could not and who takes the run instead. A failed start never fails the
dispatch, because the backup and the poll still build. A target is a small driver (`start(target,
run)`); Azure Container Apps or a custom host would be one more of the same shape.

A runner claims with the installation runner token (`VOCION_RUNNER_TOKEN`, the same value in the
app and in the runner's secrets): `POST /api/v1/runner/claim { target, workerId, workerVersion,
claimAfterSeconds, runId? }`. It takes the oldest queued engineering run from any workspace, and
the claim holds for one runner even when two race. The reply carries a **run token**, scoped to
the workspace that queued the run and good for as long as a run lasts. Every call about the run
uses it: heartbeat, complete, fail, the task record, QA artifacts, the product's QA sign-in. It
also carries the repository's push credential when the workspace has one
(`services/runners/repoCredential.ts`: the GitHub connector today, the GitHub App's installation
token when that lands). A fleet never holds a workspace's token. The Runs page and the run page
name the target that claimed each run (`worker_run.worker_target`). When nothing picks a run up,
the reconciler's ask names the target that last claimed.

The on-box services are behind the compose profile `runner`; an installation turns them on with
`COMPOSE_PROFILES=runner` once its `runner.env` and the image are in place, so a box that cannot
pull the image yet never fails a deploy for it. The on-box runner's secrets live in `runner.env` beside `.env.production`
(`infra/aws/runner.env.example`). Nothing of the app's goes there, because everything in the
runner's environment is visible to the engineer's tests. With no `runner.env` it idles.

## Running it

The same image runs everywhere. A deploy target only decides where the container starts.

| Variable | Meaning |
|---|---|
| `VOCION_URL`, `VOCION_RUNNER_TOKEN` | the installation, and its runner token: claim from every workspace on it |
| `VOCION_TOKEN` | instead, one workspace's token: claim that workspace's runs only |
| `WORKER_RUN_ID` | claim that run; unset, poll for `POLL_MAX_SECONDS` (900) |
| `RUNNER_TARGET` | which target this container is (`on-box`, `aws-fargate`, `local`), reported at claim |
| `RUNNER_CLAIM_AFTER` | take only a run that has waited this many seconds (default 120, the backup); 0 is primary |
| `ANTHROPIC_API_KEY` | the model key, the only secret the engineer's process keeps |
| `GITHUB_TOKEN` | the repository token the runner's own git and `gh` use; the engineer never sees it |
| `MAX_BUDGET_USD`, `WALL_CLOCK_MINUTES` | ceilings; the run's own cap and deadline tighten them |
| `RUNNER_POSTGRES_URL` | the database the target starts beside the runner; it wins over a repo record's url, which cannot know the address on every target |
| `QA_EVIDENCE_BUCKET`, `QA_EVIDENCE_REGION`, `PRESIGN_ACCESS_KEY_ID`, `PRESIGN_SECRET_ACCESS_KEY` | where screenshots are stored; without a bucket they go into Vocion inline |
| `DEFAULT_REPO`, `DEFAULT_PRODUCT` | only for a run queued with a bare message and no contract |
| `LOCAL_TASK`, `LOCAL_TASK_JSON` | run a contract with no Vocion at all (`-` reads stdin) |

```bash
npm run test --workspace @vocion/runner
docker build --platform linux/arm64 -f packages/runner/Dockerfile -t vocion-runner packages/runner
docker run --rm -i -e ANTHROPIC_API_KEY -e GITHUB_TOKEN -e LOCAL_TASK=- vocion-runner < contract.json
```

Every phase is one JSON line on stdout, so the container's log is the run's timeline.
