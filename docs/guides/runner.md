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
| `aws-fargate` | a task in the installation's AWS account, provisioned by the instance's own IaC. Vocion starts one per run when the run is queued (`services/runners/targets.ts`, on the app's own AWS credentials: `ecs:RunTask` on the runner task definitions and `iam:PassRole` on their roles), and the instance's scheduled poll starts one more every minute as the fallback | at once (`RUNNER_CLAIM_AFTER=0`); the poll takes what waited a minute |

Every start is written on the run's progress, where the Runs page reads it: the target and task
it started, or why it could not and who takes the run instead. A failed start never fails the
dispatch, because the backup and the poll still build. A target is a small driver (`start(target,
run)`); Azure Container Apps or a custom host would be one more of the same shape.

A runner claims with a runner token: `POST /api/v1/runner/claim { target, workerId, workerVersion,
claimAfterSeconds, runId? }`. On a single-tenant installation that can be the installation runner
token (`VOCION_RUNNER_TOKEN`, the same value in the app and in the runner's secrets), which takes
the oldest queued engineering run from any workspace. An account's runner token takes only that
account's runs (see [Multi-tenant deployments](#multi-tenant-deployments)). The claim holds for
one runner even when two race. The reply carries a **run token**, bound to that one run and to the
runner holding its lease. Every call about the run uses it: heartbeat, complete, fail, the task
record, QA artifacts, the product's QA sign-in. It also carries the repository's push credential
when the workspace has one (`services/runners/repoCredential.ts`: the GitHub connector today, the
GitHub App's installation token when that lands). A fleet never holds a workspace's token. The Runs
page and the run page name the target that claimed each run (`worker_run.worker_target`). When
nothing picks a run up, the reconciler's ask names the target that last claimed.

The on-box services are behind the compose profile `runner`; an installation turns them on with
`COMPOSE_PROFILES=runner` once its `runner.env` and the image are in place, so a box that cannot
pull the image yet never fails a deploy for it. The on-box runner's secrets live in `runner.env` beside `.env.production`
(`infra/aws/runner.env.example`). Nothing of the app's goes there, because everything in the
runner's environment is visible to the engineer's tests. With no `runner.env` it idles.

## Running it

The same image runs everywhere. A deploy target only decides where the container starts.

| Variable | Meaning |
|---|---|
| `VOCION_URL`, `VOCION_RUNNER_TOKEN` | the installation, and a runner token: an account's (`vcn_runner_…`) claims that account's runs; the installation's own claims every workspace's, on a single-tenant installation only |
| `VOCION_RUN_TOKEN` | instead, a start token a target put in for one run (Fargate push): claims that run and nothing else |
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

## Multi-tenant deployments

A host that serves several companies (Vocion Cloud) sets `VOCION_MULTI_TENANT=1`. Each company is
an account with its own workspaces, and its engineering runs build its own repositories. The
runner runs that repository's code, so the runner has to belong to the company too: nothing in its
container may be able to claim, read or report on another company's runs.

Three credentials do that, and the installation runner token is not one of them. On a
multi-tenant installation `POST /api/v1/runner/claim` refuses `VOCION_RUNNER_TOKEN` with a 403 that
says so. A single-tenant installation keeps it, unchanged.

| Credential | Held by | Can do |
|---|---|---|
| **Runner token** `vcn_runner_<id>_<secret>` | a runner's secrets, as `VOCION_RUNNER_TOKEN` | claim the runs of one account, or of the workspaces it lists. Long-lived, revocable. Only its hash is stored, so it is shown once |
| **Start token** `vrt_…` (use `start`) | a container a target started for one run, as `VOCION_RUN_TOKEN` | claim that one run, as that target, while it is queued. 30 minutes |
| **Run token** `vrt_…` (use `run`) | the runner, in memory, after the claim | that run's calls only: heartbeat, checkpoint, complete, fail, the task record, QA evidence, its product's QA sign-in. Bound to the lease holder. Two hours, renewed by every heartbeat, refused once another runner holds the run and ten minutes after the run ends. It claims nothing |

### Minting runner tokens

An account admin mints them in Workforce › Settings › Developers, under **Software Factory:
runners**: a name, every workspace or a list, an expiry. The token is shown once, then only its
last four characters. Revoking stops the next claim; a run already claimed finishes on its own run
token. An operator with a shell on the instance does the same without a login in the account:

```bash
npm run runner-tokens -- mint   --account northwind --name "Northwind Fargate" [--workspaces factory,labs] [--expires-in-days 365]
npm run runner-tokens -- list   --account northwind
npm run runner-tokens -- revoke --account northwind --id <tokenId>
```

The claim applies the scope in the query that picks candidates, by joining the run's workspace to
its account (`services/runners/claimNext.ts`). A run of another account is never a candidate,
whatever the token asks for: not the oldest run on the host, not a run named by id. A run whose
workspace has no project row is claimable only by the installation token.

### Which target builds a workspace

A workspace, or its account for every workspace that names none, can name the target that builds
its runs: the same section of Settings › Developers, or
`npm run runner-tokens -- target --account northwind [--workspace factory] --target northwind-fargate`
(`any` clears it). The target must be one the installation declares in `VOCION_RUNNERS`. Then:

- only a runner claiming as that target is given the workspace's runs;
- the Fargate push starts the run's task on that target, never on the installation's first one;
- a workspace that names a polled target (`on-box`) gets no push, and one that names a target the
  installation no longer declares gets a note on the run saying so.

A company with its own capacity is one more target in `VOCION_RUNNERS`, with its own cluster,
subnets, security groups and task role, and its workspaces name it.

### No long-lived credential beside the repository

Repository code runs as the same user in the same container as the runner, and can read the
start-up environment of any process of that user (`/proc/<pid>/environ`). So the runner never
builds in a process that holds a credential able to claim:

- **Fargate push** (`services/runners/targets.ts`). Core puts a start token for the run in the
  task's overrides and nothing else: no runner token, no installation token. The push task
  definition needs no Vocion secret at all.
- **Poll and on-box.** The entrypoint claims in a process of its own (`runner.mjs --claim-to`),
  which writes the claim (the run, its run token, the push credential) to a private file and exits.
  The entrypoint then replaces itself with the runner, started with `VOCION_RUNNER_TOKEN`,
  `VOCION_RUN_TOKEN`, `VOCION_TOKEN`, `GITHUB_TOKEN` and `GH_TOKEN` removed from its environment.
  The runner reads the file and deletes it before it clones (`packages/runner/src/handoff.mjs`).
  A start token wins over a runner token when a container has both.

What remains in reach of the repository is the run token, for its own run.

### Setting up a multi-tenant installation

1. Set `VOCION_MULTI_TENANT=1` on the app. Leave `VOCION_RUNNER_TOKEN` unset there; nothing would
   accept it.
2. For each Software Factory account, mint a runner token for the runners that build its runs.
3. For a company with its own capacity, declare its target in `VOCION_RUNNERS` and name it on the
   account (or its workspaces).
4. The Fargate push needs no token. A scheduled poll task, and an on-box runner, each hold one
   account's runner token as `VOCION_RUNNER_TOKEN`. One `runner.env` is one account: an on-box
   backup on a shared host serves at most one account, or none.
