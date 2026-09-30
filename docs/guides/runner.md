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
| `aws-fargate` | a task in the installation's AWS account, provisioned by the instance's own IaC | at once |

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
| `RUNNER_POSTGRES_URL` | where `postgres` answers when the contract names no url |
| `QA_EVIDENCE_BUCKET`, `QA_EVIDENCE_REGION`, `PRESIGN_ACCESS_KEY_ID`, `PRESIGN_SECRET_ACCESS_KEY` | where screenshots are stored; without a bucket they go into Vocion inline |
| `DEFAULT_REPO`, `DEFAULT_PRODUCT` | only for a run queued with a bare message and no contract |
| `LOCAL_TASK`, `LOCAL_TASK_JSON` | run a contract with no Vocion at all (`-` reads stdin) |

```bash
npm run test --workspace @vocion/runner
docker build --platform linux/arm64 -f packages/runner/Dockerfile -t vocion-runner packages/runner
docker run --rm -i -e ANTHROPIC_API_KEY -e GITHUB_TOKEN -e LOCAL_TASK=- vocion-runner < contract.json
```

Every phase is one JSON line on stdout, so the container's log is the run's timeline.
