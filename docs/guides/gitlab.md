# GitLab

The `gitlab` source puts the merge requests and issues of the GitLab projects
it lists into the knowledge index, and makes GitLab a **code host** of the
workspace: the repo family's tools and actions GitHub answers
([github.md](github.md)) answer for GitLab too — gitlab.com or self-managed.

## What it syncs

One document per merge request (`group/project!12`: title, state, branches,
author, description) and per issue (`group/project#4`: title, state, labels,
assignees, description), updated since the last run less five minutes, or
`lookbackDays` back on a full run. A project that cannot be read is reported
and the others carry on.

```yaml
kind: gitlab
config:
  repos: [northwind/orders-api, northwind/platform/web] # full paths
  baseUrl: https://gitlab.com # or your self-managed instance
  lookbackDays: 30
  includeIssues: true
```

## What agents can do

The repo family (`services/repo/provider.ts`), chosen from a URL's host or the
source that lists the project:

| | |
|---|---|
| `repo_read_pull` | A merge request: description, branches, head commit, files with line counts, approvals, and its head pipeline's jobs as checks. |
| `repo_read_diff` | A merge request's diff or a comparison, as a unified diff with `diff --git` headers, and which files fall outside a task's allowed paths. |
| `repo_read_file`, `repo_read_tree` | A file at a ref (the default branch when none), and the whole tree. A path cannot climb out of the project. |
| `repo_read_pipeline_runs` (granted) | Pipelines newest first, the newest three with their jobs. |
| `repo.comment_pull` | A note on the merge request; Undo deletes it. |
| `repo.submit_review` | A note, inline discussions on diff lines, and an approval when it approves; Undo unapproves and deletes the note. GitLab has no "request changes" call, so that review is a note that says so. |
| `repo.cancel_pipeline_run` | Cancels a running pipeline; Undo retries it. |

## Auth

A **personal, project or group access token** with `read_api` — or `api`, if
agents may comment, approve, or cancel and retry pipelines — sent as a Bearer
token. Make it at gitlab.com → User settings → Access tokens, or on your own
instance. Test connection names the account, the token's scopes, and each
project. No OAuth app is needed.
