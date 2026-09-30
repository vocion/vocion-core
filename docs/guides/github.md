# GitHub as an event source

A workspace lists the repositories it cares about, and Vocion turns what happens
on them — a pull request opened, its checks finishing, a review landing, the
merge, a deploy run failing on `main` — into events. Automations already fire
on events (`when: { event }`, see [Automation](../entities/automation.md)); this
connector is what emits them, so the planner learns that a factory branch went
red without a person polling GitHub by hand.

It is read-only, it mirrors almost nothing (one small document per pull request
so the PR is searchable), and it needs one token per workspace.

## What it emits

Every `pr.*` payload carries the same base fields, so one filter vocabulary
works across the lifecycle:

| Field | What it is |
|---|---|
| `repo` | `owner/name`, as the source lists it |
| `number` | pull request number |
| `url` | the pull request page |
| `headSha` | the head commit at the time of the event |
| `branch` | the head branch, e.g. `factory/task-042` |
| `baseBranch` | what it targets, usually `main` |
| `title`, `author` | as GitHub shows them; `author` is a login |
| `state` | `open` or `closed` at the time of the event |
| `draft` | boolean |
| `dedupeKey` | `github:<repo>#<number>:<event>:<headSha>` — also the idempotency key handed to `emitEvent` |

| Event | When | Extra fields |
|---|---|---|
| `pr.opened` | a pull request was opened, reopened or marked ready for review | — |
| `pr.synchronized` | new commits were pushed to an open pull request | — |
| `pr.checks_completed` | every check run on the head commit has finished | `conclusion` (`success` \| `failure`), `failedChecks` (names joined with `, `, empty on success), `failedCheckCount`, `checkCount` |
| `pr.review_submitted` | a review was submitted | `reviewState` (`approved` \| `changes_requested` \| `commented` \| `dismissed`), `reviewer`, `reviewId`, `reviewedSha`, `reviewUrl`, `submittedAt` |
| `pr.merged` | the pull request was merged | `mergeSha`, `mergedAt` |
| `pr.closed` | closed without merging | `closedAt` |
| `run.failed` | a GitHub Actions run on the deploy branch completed without succeeding | `runId`, `runNumber`, `runAttempt`, `name` (the workflow), `branch`, `headSha`, `event` (`push`, `workflow_dispatch`…), `conclusion` (`failure`, `timed_out`, `startup_failure`…), `url`, `completedAt`, `dedupeKey` |

Every field is a scalar, because `when.filter` compares with `===`. That is why
the failed check names arrive as one comma-joined string rather than a list.

`pr.checks_completed` is only raised once **all** check runs on the head commit
have a conclusion; a commit that has no checks at all is not a commit whose
checks passed, so it raises nothing. `neutral` and `skipped` count as passing.
A cancelled Actions run is somebody's choice, not a failure, so it raises no
`run.failed`.

### Idempotency

The dedupe key holds the head sha, so a re-poll of unchanged state is absorbed
by `emitEvent` (recorded as `deduped`, nothing fires), while a push that moves
the head is a new event. Reviews add their id (`…:<headSha>:<reviewId>`), since
two reviews can land on one sha; a failed `pr.checks_completed` adds the newest
check run's id (`…:<headSha>:failed-<checkRunId>`), since a re-run of the failed
jobs finishes on the same head with new check runs, and a pass keeps the
sha-only key; failed runs are keyed on run id and attempt
(`github:<repo>:run.failed:<runId>:<attempt>`), so a re-run that fails again is
a new event.

A delivery GitHub failed to make is never redelivered. The software factory's
`factory-reconcile` automation reads every open factory pull request back every
five minutes and emits the event it earned with these same keys, so a missed
webhook runs its automation late instead of never, and a delivered one is a
no-op.

One consequence to know about: the poller cannot see individual pushes, only
that a pull request moved. It emits `pr.synchronized` for the head sha it sees,
and the key does the rest — a PR that was commented on but not pushed dedupes
against the sha it already emitted.

## Example automation

The software-factory plugin ships `factory-ci-failure`, wired to a placeholder
event name because core had no CI adapter. With this source connected, a
workspace overrides that file by slug and names the real event:

```yaml
# automations/factory-ci-failure.yaml
slug: factory-ci-failure
name: A failed check reopens the task
status: active
agent: product-manager
when:
  event: pr.checks_completed
  filter:
    conclusion: failure
do:
  checkMission: close-the-gap
  prompt: >-
    A required check failed on {{branch}} ({{url}}): {{failedChecks}}.
    Find the engineering task whose branch carries it and decide the next attempt.
```

Other shapes that fall out of the same events:

```yaml
when: {event: pr.review_submitted, filter: {reviewState: changes_requested}}
---
when: {event: pr.merged, filter: {repo: acme/api}}
---
when: {event: run.failed} # any failed deploy run on the deploy branch
```

## The GitHub App (recommended)

Vocion can hold its own GitHub App, one per deployment, and every workspace
connects to it. The factory then acts as the app, not as a person: installation
tokens last an hour, are scoped to the one repository a call is about, and carry
only the permissions the workspace's tier asks for (backlog 053).

1. **Create the app, once per deployment.** Open
   `/api/v1/connections/github/manifest?org=<github-org>` while signed in as a
   workspace owner (Connections → GitHub → *Create GitHub App*). Vocion posts
   GitHub a manifest: the name `Vocion <host>`, the webhook
   `https://<host>/api/webhooks/github-app`, the permissions and the events. You
   click **Create GitHub App** on GitHub. GitHub sends back a one-hour code, and
   Vocion trades it for the app's id, private key, webhook secret and client
   secret, which it seals in the vault. Nobody copies a key by hand. Leave `org`
   empty to own the app from your personal account. The app is public, so an
   owner of any organization can install it. An installation that no workspace
   is bound to does nothing.
2. **Connect a workspace, once per GitHub account.** Open
   `/api/v1/connections/github/install` (Connections → GitHub → *Connect*).
   Pick the organization and the repositories on GitHub's install screen. GitHub
   then asks you to authorize the app, which proves your GitHub account can reach
   that installation, and Vocion binds it to the workspace you started from. A
   second workspace on the same organization shares the installation and binds it
   the same way.
3. **Tiers.** `base` covers metadata R, contents RW, pull requests RW, actions RW
   and checks R: reading code and checks, pushing a branch, opening, updating and
   merging a pull request, and re-running a failed job. `pipeline` adds
   `workflows: write`, which changing `.github/workflows` needs. The app asks for
   the pipeline set when it is created, so a workspace can move between tiers
   without an owner re-approving on GitHub.

4. **On Connections** the GitHub block at the top of `/dashboard/connectors` shows
   the app and each connected account with its repositories. It offers *Change
   repositories*, which opens the installation's settings on GitHub, and
   *Disconnect*, after which this workspace stops using the installation; it stays
   installed on GitHub. It also has *Test connection*, which reads each
   installation again and mints a token at the tier, and the tier switch, *The
   Release engineer may change CI and deploy config*. The API behind the block is
   `GET|PATCH /api/v1/connections/github`, `POST …/test` and
   `DELETE …/installations/:id`.

5. **From chat, and when something is missing.** When a repository cannot be
   reached, a **connection request** is raised: one ask per GitHub account, kind
   `credential`, whose link is the install screen. For a missing permission (a
   403 on a re-run or a branch update) the link goes to the installation's
   permissions instead. The request closes by itself, marked done by the system,
   when the installation or the permission lands (`github.connected`, or the
   app's installation webhooks). Three things raise it: a seat granted
   `request_connection` (in the software-factory plugin, the PM and the Release
   engineer, so "connect vocion-core to GitHub" in chat puts up the card), a
   factory call refused for lack of access, and `factory-reconcile` finding a
   repository the workspace's GitHub sources list that nothing reaches. The
   machinery does not raise again a request that a person turned down.

`tokenForRepo` (`services/agents/tools/githubPullRead.ts`) is the one entry
point. It uses the installation that covers the repository first, and a token
vaulted on a `github` source only when no installation does. A mint GitHub
refuses is written on the installation (`last_error`) until one succeeds.

The app's webhook replaces the per-repository webhooks below. It receives the
same deliveries for every repository the app is installed on, plus
`installation` and `installation_repositories`, which keep each bound
workspace's record of the installation true. It emits the same events with the
same dedupe keys. The deliveries are resolved to the workspaces the installation
is bound to, and within those to the `github` sources that list the repository.
That keeps the source's `branchPrefix` and `deployBranch` in charge of what each
workspace hears. A source no longer needs a token of its own once the app covers
its repositories.

## Connecting it

1. **Add the source** at `/dashboard/connectors` → GitHub. Settings:

   | Setting | Default | What it does |
   |---|---|---|
   | Repositories | required | `owner/name`, comma-separated. Nothing outside this list is read. |
   | Only branches starting with | every branch | `factory/` keeps the source to what the factory pushed. `run.failed` ignores this — it is about the deploy branch. |
   | Deploy branch | `main` | Whose failed Actions runs become `run.failed`. |
   | First sync looks back (days) | 7 | The window a first run — or a full sync — reads. After that, each run picks up from the previous run's cutoff. |
   | API base URL | `https://api.github.com` | GitHub Enterprise Server: `https://<host>/api/v3`. |

2. **Connect the credential.** A GitHub **fine-grained personal access token**
   (github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained), granted on exactly the repositories the source lists, with
   read-only repository permissions:

   | Permission | For |
   |---|---|
   | `metadata:read` | reaching the repository at all (always on) |
   | `pull_requests:read` | listing pull requests and their reviews |
   | `checks:read` | check runs on a commit |
   | `contents:read` | the commit the checks hang off |
   | `actions:read` | workflow runs on the deploy branch (`run.failed`) |

   A classic PAT with `repo` (or `public_repo` for public repositories) and a
   GitHub App installation token both work too; the connector sends whichever
   it is given as a Bearer token. It is stored AES-256-GCM encrypted under the
   workspace's key, never written to the workspace YAML, never shown again, and
   used read-only — Vocion never writes to GitHub with it.

   One token serves every `github` source in the workspace: a source narrows
   by its repository list, not by credential.

3. **Test connection.** Runs read-only checks and stores nothing: the token is
   accepted (`/rate_limit`, which costs no quota), then for each repository
   whether it is reachable and whether one pull request, one commit's check
   runs and one Actions run can be read. Fine-grained tokens do not list their
   permissions anywhere, so these reads **are** the permission check — a 403
   comes back naming the permission GitHub asked for, and a private repository
   the token was not granted comes back as GitHub's 404, with a note saying
   that is usually what a 404 means. Classic tokens have their scopes reported
   from the `x-oauth-scopes` header.

4. **Schedule it.** Polling interval is the source's `schedule`, like every
   other connector. Every five minutes is a reasonable shape for a factory
   that wants to react to a red check inside the same hour:

   ```yaml
   # sources/github-factory.yaml
   slug: github-factory
   name: GitHub — factory repositories
   description: Pull request and deploy events on the repositories the factory may touch.
   kind: github
   config:
     repos:
       - acme/api
       - acme/web
     branchPrefix: factory/
     deployBranch: main
   schedule: '*/5 * * * *'
   reconcileSchedule: false
   enabled: true
   ```

   Each poll costs, per repository: one request per 100 pull requests updated
   since the last run, plus two per updated pull request (check runs, reviews),
   plus one for the deploy branch's runs. A quiet repository is three requests.

## The webhook — the same events, sooner

`POST /api/webhooks/github` receives GitHub's deliveries and emits the same
events with the same dedupe keys, so a webhook and the poll can both be on and
nothing fires twice; the poll is what makes a missed delivery harmless.

1. Set `GITHUB_WEBHOOK_SECRET` on the server. Unset, the route answers 501 and
   the source relies on polling alone.
2. On the repository (or the organization): **Settings → Webhooks → Add
   webhook**. Payload URL `https://<your-vocion-host>/api/webhooks/github`,
   content type `application/json`, the same secret, and these events:
   *Pull requests*, *Pull request reviews*, *Check suites*, *Workflow runs*.

Every delivery is verified with `X-Hub-Signature-256` (HMAC-SHA256 over the raw
body, compared in constant time) **before** it is parsed; an unverified request
is a 401, never a 200. The org is resolved from the repository: every enabled
`github` source that lists `repository.full_name` gets the events, each through
its own branch prefix and deploy branch. Automations are dispatched in the
background so the acknowledgement goes back inside GitHub's ten-second window.

A `check_suite` delivery names the pull requests it touched but carries neither
their titles nor the check names, so the receiver reads both from the API with
the source's own vaulted token. A source with no credential yet still receives
the lifecycle events; its `pr.checks_completed` arrives with the next poll.

## What gets stored

One `knowledge_document` per pull request the poll saw, titled
`<repo>#<number>: <title>`, whose body is the title, state (`open`, `closed`,
`merged`), branches, author and URL — enough for `search_knowledge` to find
"the PR that touched pricing" and land on GitHub. Metadata carries `repo`,
`number`, `state`, `headSha`, `branch`, `baseBranch`, `author`, `mergeSha`.

Nothing else is mirrored: no diffs, no file contents, no comments, no check
logs. This connector is about events. A **full** sync (the manual Sync now, or
a `reconcileSchedule` if you set one) reads only the look-back window, so pull
request documents older than it are retired from search then; set
`reconcileSchedule: false` if you would rather keep them.

## The checkpoint

Every run asks GitHub for pull requests updated since the previous run's cutoff
(`source_sync_checkpoint.since`), newest first, and stops walking at the first
one older than that. A repository the run could not read is reported as a
connector error and the rest carry on; the orchestrator then leaves the
watermark where it was, so the next run re-covers the window this one missed.
An event that could not be dispatched holds the watermark back the same way.

## Related

[Automation](../entities/automation.md) · [Source](../entities/source.md) · the
software-factory plugin's `factory-ci-failure` automation
