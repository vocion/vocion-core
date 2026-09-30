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

## Running it

The same image runs everywhere. A deploy target only decides where the container starts.

| Variable | Meaning |
|---|---|
| `VOCION_URL`, `VOCION_TOKEN` | the installation and a token that can claim its runs |
| `WORKER_RUN_ID` | claim that run; unset, poll the queue for `POLL_MAX_SECONDS` (900) |
| `RUNNER_TARGET` | which target this container is (`on-box`, `aws-fargate`, `local`), reported at claim |
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
