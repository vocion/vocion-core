# GitLab as a code host

A workspace whose code lives on GitLab, on gitlab.com or on its own
self-managed instance, lists the projects it cares about, and Vocion treats
them the way it treats GitHub repositories. What happens on them (a merge
request opened, its pipeline finishing, an approval, the merge, a deploy
pipeline failing on `main`) becomes the same events GitHub's activity does, so
the same automations fire; agents read and write merge requests through the
same tools and actions; and the software factory pushes its branches and opens
merge requests there.

GitLab is the second provider of the **repo family**
(`src/services/repo/provider.ts`, `providers/gitlab.ts`). Nothing an agent is
told names the vendor. GitLab's words map onto the family's like this:

| GitLab | The repo family |
|---|---|
| merge request `!9` | pull request number 9 |
| the jobs of the merge request's head pipeline | its checks |
| approve, unapprove | a review that approves, its dismissal |
| a note, and discussions on lines of the diff | a review that requests changes or comments, with its findings inline |
| a pipeline | a pipeline run |
| `group/subgroup/project` | the repository, as a path of any depth |

A project path can be nested, so everything that takes a repository takes a
path of any depth, and every API call names the project by its whole path,
URL-encoded as one segment.

## What it emits

Exactly what the [GitHub source](./github.md#what-it-emits) emits, with the
same payload fields, so one filter vocabulary works on both hosts:

| Event | When, on GitLab | Notes |
|---|---|---|
| `pr.opened` | a merge request was opened or reopened | `repo` is the project path, `number` the merge request's `iid`, `url` its page |
| `pr.synchronized` | new commits were pushed to an open merge request | |
| `pr.checks_completed` | every job of the head pipeline has finished | `failedChecks` names jobs as `stage: name`. A job allowed to fail counts as `neutral`, a manual job nobody started as `skipped`, both passing. A merge request with no pipeline on its head raises nothing. |
| `pr.review_submitted` | an approval (`approved`), an unapproval (`dismissed`), or GitLab 17's "requested changes" (`changes_requested`) | read from GitLab's own system notes; `reviewId` is the note's id |
| `pr.merged` | the merge request was merged | `mergeSha` is the merge commit, else the squash commit, else the head of a fast-forward |
| `pr.closed` | closed without merging | |
| `run.failed`, `run.succeeded` | a pipeline on the deploy branch finished | `runId` is the pipeline id, `runNumber` its `iid`, `name` its name (or `pipeline`), `event` its source (`push`, `schedule`, `web`…), `path` is `.gitlab-ci.yml` |

### Idempotency

Dedupe keys have the GitHub shape with a `gitlab:` prefix:
`gitlab:<project>#<iid>:<event>:<headSha>`, a failed checks event adds
`:failed-<newest job id>` (a retried job is a new job, so a retry that fails
again is a new event), a review adds the note id, and a pipeline run is
`gitlab:<project>:run.failed:<pipelineId>:1:<finishedAt>`. GitLab retries a
pipeline in place, keeping its id, so the time it finished is what tells a
retry that failed again from a re-poll of the same failure. The poll, the
webhook, the factory's five-minute reconcile and Vocion's own merge all build
the same key for the same state, so whichever lands second is absorbed.

## Connecting it

1. **Add the source** at `/dashboard/connectors` → GitLab. Settings:

   | Setting | Default | What it does |
   |---|---|---|
   | Projects | required | Each project's path as in its URL: `group/project` or `group/subgroup/project`, comma-separated. Nothing outside this list is read or written. |
   | Only branches starting with | every branch | `factory/` keeps the source to what the factory pushed. Run events ignore this. |
   | Deploy branch | `main` | Whose finished pipelines become `run.failed` / `run.succeeded`. |
   | First sync looks back (days) | 7 | The window a first run, or a full sync, reads. |
   | GitLab instance | `https://gitlab.com` | A self-managed GitLab: its address, e.g. `https://gitlab.acme.example` (the API root `/api/v4` is accepted too and trimmed). |

2. **Connect the credential**, one of two ways.

   - **Connect with GitLab** (when the deployment registered an application,
     below): the person signs in with their GitLab account and consents once.
     The login holds an access token that lives two hours and a refresh token;
     every use refreshes an expiring token first and saves the rotated pair
     (the sync, every agent read and write, the runner's push credential), so
     nothing expires under a running factory.
   - **Paste an access token**: a personal, project or group access token. A
     project or group token is a bot account, which is usually what a factory
     wants: its merge requests and approvals are not a person's.

   | Scope | For |
   |---|---|
   | `read_api` | the poll and every read: merge requests, diffs, files, the tree, pipelines and jobs, notes |
   | `api` | the writes: a comment, an approval, a merge, a pipeline change, a revert, and the factory pushing its branches and opening merge requests |

   The member role needs Developer or above to push and Maintainer to merge
   into a protected branch, as on GitLab itself. The credential is stored
   AES-256-GCM encrypted under the workspace's key and never shown again. One
   credential serves every `gitlab` source in the workspace; a source narrows
   by its project list.

3. **Test connection.** Read-only, stores nothing: the token is accepted and
   which scopes it holds (`/personal_access_tokens/self`), whether it can
   write (`api`) or only read, then for each project whether it is reachable
   (its default branch and visibility) and whether one merge request and one
   pipeline can be read. A private project the token was not granted answers
   GitLab's 404, and the line says that is usually what a 404 means.

4. **Schedule it.** The source's `schedule`, like every connector:

   ```yaml
   # sources/gitlab-factory.yaml
   slug: gitlab-factory
   name: GitLab, factory projects
   kind: gitlab
   config:
     projects:
       - northwind/platform/api
       - northwind/platform/web
     branchPrefix: factory/
     deployBranch: main
     baseUrl: https://gitlab.com
   schedule: '*/5 * * * *'
   reconcileSchedule: false
   enabled: true
   ```

   Each poll costs, per project: one request per 100 merge requests updated
   since the last run, three per updated merge request (the merge request,
   its head pipeline's jobs, its notes), and one for the deploy branch's
   pipelines.

### Connect with GitLab

An admin registers one OAuth application, once per deployment:

1. On the GitLab instance (gitlab.com, or your own): **Preferences →
   Applications → Add new application** (a group's **Settings → Applications**
   works too, and an instance administrator can add one under **Admin →
   Applications**).
2. **Redirect URI**: `https://<your-vocion-host>/api/connect/gitlab/callback`.
3. **Confidential**: checked.
4. **Scopes**: `api` and `read_user`.
5. Save, and set on the server: `GITLAB_OAUTH_CLIENT_ID` (the Application ID),
   `GITLAB_OAUTH_CLIENT_SECRET` (the Secret) and, for a self-managed
   instance, `GITLAB_OAUTH_BASE_URL` (`https://gitlab.acme.example`; gitlab.com
   when unset).

With those unset, the connect sheet offers token paste only. The login is an
authorization-code flow with PKCE (S256): the verifier is derived from the
signed state on the server and never reaches the browser.

A deployment holds one GitLab instance per workspace (the `gitlab` credential
platform is one live credential, as GitHub's is), so a workspace that needs
gitlab.com and a self-managed instance side by side is a named limit below.

## What agents read and write

The [repo family's](./github.md#the-repo-family-what-an-agent-reads-and-writes)
tools and actions, unchanged, with the workspace's own GitLab credential:

| Tool or action | On GitLab |
|---|---|
| `repo_read_pull` | the merge request: description, author, branches, head commit, the files it changes with line counts, approvals, the head pipeline's jobs as checks, labels |
| `repo_read_diff` | the merge request's diff (`raw_diffs`, or built from the per-file diffs on an older instance), or two refs compared from their merge base |
| `repo_read_file`, `repo_read_tree` | a file at a ref; the whole tree in keyset pages (`.gitlab-ci.yml` is named as the pipeline file) |
| `repo.comment_pull` | a note; Undo deletes it |
| `repo.submit_review` | approve: the approval, bound to the head the reviewer read; request changes or comment: a note, with each finding a discussion on its line of the diff; Undo unapproves and deletes the note |
| `repo.cancel_pipeline_run` | cancels a running pipeline; Undo retries it |
| `repo.open_pull` | the pipeline's own fix as one commit on a `vocion/pipeline-…` branch and its merge request; Undo closes it and deletes the branch, or opens the revert once merged |
| `describe_sources` | for each listed project, asked of GitLab at the time of the question: reachable, with its default branch and visibility, or not, with GitLab's reason |

`repo_read_check_logs`, `repo_read_pipeline_runs`, `repo.rerun_failed_checks`
and `repo.dispatch_pipeline` read and drive GitHub Actions; on a GitLab project
they say so and point at what does work (see Limits).

### The software factory on a GitLab project

- **The engineer's branch.** A repo record whose `url` (or `cloneUrl`) is the
  project's GitLab address is what the dispatch puts on the contract. At
  claim, the runner is handed the project's credential with `host: gitlab`;
  it pushes as `oauth2:<token>`, opens the merge request through the API
  (a draft, labelled `checks-failed`, for work it keeps after a failure), and
  treats `.gitlab-ci.yml` as a person's file it never changes.
- **QA.** The verdict binds to the merge request's head, read from GitLab, and
  is filed on the merge request as a review.
- **The merge.** Approving the merge card (a person, or the trust rule for its
  risk class) merges through GitLab onto the head QA judged, only with every
  job green, squashing unless the project forbids it, and raises `pr.merged`
  at once. Undo opens the revert as a merge request.
- **The reconcile.** Every five minutes open factory merge requests are read
  back: a missed `pr.checks_completed`, `pr.merged` or `pr.closed` is raised
  late instead of never, and a merge request that conflicts with its target
  goes back to the engineer. A replaced attempt's merge request is closed with
  a note.

## Using it

**Read a merge request in chat.** Any agent with the gitlab source in its
`connectorSources` has the reads. Ask in words, with the URL or the path:

- "Review https://gitlab.com/northwind/platform/api/-/merge_requests/42 against
  its contract" (reads it with `repo_read_pull`, then the diff)
- "What does !42 in northwind/platform/api change outside src/?" (`repo_read_diff`)
- "Show me .gitlab-ci.yml on main in northwind/platform/api" (`repo_read_file`)
- "Map the architecture of northwind/platform/api" (`repo_read_tree`)
- "Which GitLab projects can you reach?" (`describe_sources`, asked of GitLab now)
- "Approve !42" or "Leave a comment on !42 that the migration needs a rollback"
  runs as your action, with Undo.

**Have the factory build something.** File the request on the product whose
repo record points at the GitLab project ("Add a reassign button to the
dispatcher's route page"). The factory plans it and dispatches an engineering
task; a runner claims it, builds on a `factory/<task>` branch and opens the
merge request. From there the events drive the loop:

| Event | What usually answers it |
|---|---|
| `pr.opened` | the automation that starts QA's review of an engineering task's change |
| `pr.checks_completed` with `conclusion: failure` | the CI-failure automation: read what failed and send the attempt back |
| `pr.checks_completed` with `conclusion: success` | QA's review, which records a verdict and proposes the merge |
| `pr.review_submitted` | a person's approval or request for changes, written on the task |
| `pr.merged` | the delivery: the request records who merged it and when, and the deploy is watched |
| `run.failed` on the deploy branch | the pipeline's owner reads the failure and answers it |

An automation names an event and, if it wants, a filter, and is the same file
for both hosts:

```yaml
when: {event: pr.checks_completed, filter: {conclusion: failure}}
---
when: {event: pr.merged, filter: {repo: northwind/platform/api}}
---
when: {event: run.failed} # any failed pipeline on the deploy branch
```

## The webhook, the same events sooner

`POST /api/webhooks/gitlab` receives GitLab's deliveries and emits the same
events with the same dedupe keys; the poll stays the net under a missed
delivery.

1. Set `GITLAB_WEBHOOK_SECRET` on the server. Unset, the route answers 501 and
   the source relies on polling alone.
2. On the project or its group: **Settings → Webhooks → Add new webhook**. URL
   `https://<your-vocion-host>/api/webhooks/gitlab`, **Secret token** the same
   secret, and the triggers **Merge request events** and **Pipeline events**.

GitLab sends the secret itself in `X-Gitlab-Token`; it is compared in constant
time **before** the body is parsed, and a delivery without it is a 401. The
workspace is found from the delivery's project and instance: every enabled
`gitlab` source that lists `project.path_with_namespace` on that host gets the
events, each through its own branch prefix and deploy branch. A hook names the
actor rather than the author, carries no jobs and no note id, so with the
source's credential the receiver reads the merge request whole, the head
pipeline's jobs and the approval note, and builds the event exactly as the poll
would. A source with no credential still gets the lifecycle events; its checks
and approvals arrive with the next poll.

## What gets stored

One `knowledge_document` per merge request the poll saw, titled
`<project>!<iid>: <title>`, whose body is the title, state, branches, author
and URL. Its metadata carries the GitHub source's keys (`kind: pull_request`,
`repo`, `number`, `state`, `headSha`, `branch`, `baseBranch`, `author`,
`requestedReviewers`, `draft`, `mergeSha`) plus `host: gitlab`, so search,
the `code.merge_request` facets and the "Pull requests awaiting my review"
view read both hosts alike. Nothing else is mirrored.

## Limits

- **One GitLab instance per workspace.** The credential platform holds one
  live credential, so gitlab.com and a self-managed instance side by side need
  `many` credentials and the migration that rebuilds the live-credential index.
- **GitHub Actions only, for now:** the job logs behind a failed check
  (`repo_read_check_logs`, and the CI diagnosis that reads them), a project's
  pipeline list (`repo_read_pipeline_runs`), re-running only the failed jobs
  of a merge request (`repo.rerun_failed_checks`; cancelling and retrying a
  pipeline by its URL works), starting a pipeline by hand
  (`repo.dispatch_pipeline`), the environments' deploy tracking and the missed
  deploy watch, adopting an untracked pipeline change, and publishing a page
  to a site in a repository.
- **Commit statuses from an outside CI** (a Jenkins posting to GitLab) are not
  read as checks: only the pipeline's jobs are.
- **A self-managed instance served under a path prefix**
  (`https://code.acme.example/gitlab`) works through the source's instance
  setting, but a bare merge request URL from it is read as a project path that
  includes the prefix.
- **A fast-forward merge without a squash** has no one commit to revert: Undo
  says so and the revert is made on GitLab by hand.
- **Findings on lines** need GitLab to have computed the merge request's
  `diff_refs`; a review with no diff yet is filed as its note alone.

## Related

[GitHub](./github.md) · [The runner](./runner.md) ·
[Automation](../entities/automation.md) · [Login apps](./login-apps.md)
