# GitHub as an event source

A workspace lists the repositories it cares about, and Vocion turns what happens
on them — a pull request opened, its checks finishing, a review landing, the
merge, a deploy run failing on `main` — into events. Automations already fire
on events (`when: { event }`, see [Automation](../entities/automation.md)); this
connector is what emits them, so the planner learns that a factory branch went
red without a person polling GitHub by hand.

The connector only reads, it mirrors almost nothing (one small document per pull
request so the PR is searchable), and it needs one credential per workspace: a
token, or the GitHub App's installation (see *Connect with GitHub* below).

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

## Connect with GitHub — the app instead of a token

When the deployment is a GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET` set), the source's credential form shows
**Connect with GitHub** instead of a token field. The person is sent to the
app's install page on GitHub, chooses the organization and the repositories
the app may see, and comes back. Nothing is pasted.

The app's repository permissions are the deployment's to choose, and the
person installing it sees and grants exactly that list. Reading the events
above takes **Metadata**, **Pull requests**, **Checks**, **Contents** and
**Actions**, all read. A deployment whose workers also act on the repositories
— push a factory branch, open a pull request, start a workflow — grants
**Contents**, **Pull requests**, **Actions** and **Workflows** as read and
write instead. The connector never writes with any of it: the only request it
makes beyond reading is minting the installation token itself, and a write is
an action that goes through the review queue and the trust ladder, not
something a permission turns on.

The app asks for user authorization during installation, so the callback
also carries a short-lived code; Vocion turns it into a user token, checks
the installation is one that person can see, and drops the token. That is
what stops an admin of one workspace storing another organization's
installation — installation ids are small integers and the app itself can
read every one of them.

What is stored is the **installation**: its id, the account it is on, and the
repositories it was granted. No token is stored. Every call on the source's
behalf mints an installation token from the app's private key
(`libs/github/app.ts`), good for an hour and cached in memory until five
minutes before it expires, so a poll over ten repositories mints once.

The source's `config.repos` still bounds what is read, and must be a subset
of what the installation was granted — the list is the factory's scope, the
installation is GitHub's. **Test connection** reports any repository listed
in the source that the installation does not include, by name, so the fix
is one click on GitHub's installation page or one line in the YAML.

The app's webhook uses the same `GITHUB_WEBHOOK_SECRET` as a repository
hook would: the secret authenticates GitHub, and the workspace is found from
the delivery. A delivery from the app carries `installation.id`; a source
whose credential is a different installation is skipped, and a
pasted-token source listing the same repository still receives it.

Installing on an organization you do not own files a **request** to its
owners; the callback says so and stores nothing until an owner approves and
GitHub sends them to the Setup URL.

## Asking an agent what it reaches

"Which repositories do you have access to?" is answered by the `describe_sources`
tool, on for every agent: the repositories the source lists, each checked
against what GitHub says the installation grants — asked of GitHub at the time
of the question, not read from a snapshot or the operating intent — plus the
branch filter, the deploy branch, whose account the installation is on, the
last run and how many documents the index holds. A repository the source lists
that the app was not granted is named as such; so is one the app was granted
that the source does not list. The same tool describes a `jira` or `slack`
source from its config and grant. Nothing secret is read into the answer.

## The repo family: what an agent reads and writes

GitHub is the first provider of the **repo family** — the code host, named for
its constructs (`src/services/repo/provider.ts`). An agent's tools and actions
say "pull request", "check", "pipeline run" and "review", never "GitHub"; the
URL's host, or the github source that lists an `owner/name`, picks the
provider. Bitbucket, Azure DevOps and GitLab plug in as further
`providers/<host>.ts` behind the same interface, and nothing an agent is told,
no trust rule and no skill changes when they do.

Reads, through the workspace's own credential for the repository (so a
private repository answers):

| Tool | What it returns | Present for |
|---|---|---|
| `repo_read_pull` | one pull request, live: title, description, author, branches, head commit, files changed, reviews, check conclusions, labels | any agent with a repo source in `connectorSources` |
| `repo_read_diff` | the unified diff of a pull request or of two refs, the files it touches, and with `task_id` the files outside the task's `allowedPaths` | same |
| `repo_read_file` | a file at a ref, whole (cut at 60k) | same |
| `repo_read_tree` | the whole tree at a ref in one call (the default branch when none is given): top-level folders with file counts and extensions, paths to three levels, the manifest files found, and the text of up to eight of them in one character budget | same |
| `repo_read_check_logs` | each failing check, its annotations, the failing step's log tail; whether the base branch is red too (formerly `github_read_check_logs`) | granted (`harness.grantTools`), by either name |
| `repo_read_pipeline_runs` | a repository's pipeline runs, newest first, each with its jobs and the step that failed (formerly `github_read_workflow_runs`) | granted, by either name |

Writes, each an action proposed through `propose_action`, so the trust ladder,
the ledger and Undo apply ([agent tools that write](./agent-tools.md)). A
former id in brackets is still accepted by `propose_action`, by a trust rule
and by a grant; a new run is recorded under the current id.

| Action | What it does | Undo |
|---|---|---|
| `repo.comment_pull` | a comment on the pull request: the run report, why a check is red | deletes the comment |
| `repo.submit_review` | a review — approve, request changes, comment — with findings inline on their lines; `record_verdict` proposes one for every verdict it records | dismisses an approval or a request for changes |
| `repo.rerun_failed_checks` (`github.rerun_failed_jobs`) | re-runs the failed jobs of a red head once | cancels the re-run while it runs |
| `repo.cancel_pipeline_run` | stops a run that should not be running: a duplicate deploy, a loop | starts the run again |
| `repo.dispatch_pipeline` (`github.dispatch_workflow`) | starts a pipeline by hand: a deploy that should have run, a redeploy | cancels the run while it runs |
| `repo.open_pull` (`github.open_pull`) | files written as one commit on a `vocion/pipeline-…` branch and its pull request, for the pipeline's own fix | closes it and deletes the branch, or reverts it once merged |
| `repo.revert_pull` (`github.revert_pull`) | the host's revert of a merged pull request, for a release that took an environment down | closes the revert, or reverts the revert |

`repo.open_pull`, `repo.dispatch_pipeline` and `repo.revert_pull` are the
pipeline's own moves: only a person, or an agent whose harness grants the
action by either id, may propose one (`mayActOnPipeline`).

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
