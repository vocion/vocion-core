---
slug: debug-a-production-error
name: Debug a production error
description: >-
  Given a reported production error — a 500, a screenshot, a route, a time —
  find the product and environment, read the error tracker for that project,
  environment and release, read the top issue's stack and map it to the
  repository, correlate its release with the last deploy and merge, and end
  with a move: revert the deploy that caused it, or file the bug with the
  stack as evidence. Never ends in prose alone.
version: 1
---

# Debug a production error

A person saw something break on the live product: "every page says 500",
a screenshot of an error toast, a route and a time. Your job is not to
explain what might be wrong. It is to find what production recorded, decide
whether a deploy caused it, and **make the move** — in this turn.

## 1. Find the product and the environment

- From the person's words, the screenshot or the URL: which product, which
  surface (the API behind a page, the web app, the marketing site).
- `lookup_objects` on the product's environments. The one that served the
  failing request (its `url` matches the host) is the one you debug. Its
  record says where its errors go (`observability.sentry`: org, project,
  environment), what it runs (`lastDeployedSha`, `lastDeployedAt`), the
  commit it was last healthy on (`lastHealthySha`), and its repository.
- A page that fails because the API behind it fails is the **API's**
  environment: the browser's 500 came from the API host.
- When no environment names an error-tracking project, say so in one line
  and name the field to set (`observability.sentry`). Then go on with what
  you can read (the health check, the deploy runs).

## 2. Read what production recorded

- `sentry_issues` with `environment_record` (the record's slug), and:
  - `around` the time the person saw it (their words, a screenshot's clock),
    with a `window_minutes` that covers it; or
  - `release` = the deployed commit with `first_seen_in_release: true`, to see
    what the last deploy introduced; or
  - nothing else, for the busiest open issues of the last 24 hours.
- The top issue by events, whose title or route matches what the person saw,
  is the one. Name it by its short id and link it.

## 3. Read the stack and map it to the repository

- `sentry_issue` with its short id (and the environment). Read:
  - the exception type and the first lines of its message: it often says
    exactly what is wrong (a missing engine, a null field, a timeout);
  - `appFrames`, the product's own frames: drop the container root (`/app/`)
    and read a built path back to its source (`dist/auth/plugin.js` →
    `src/auth/plugin.ts`). Name the file and line;
  - the request (method, URL, status) and the breadcrumbs just before it.
- Quote the line of the message that settles what broke. A title is not
  evidence; the message and the frame are.

## 4. Correlate the release with the deploy and the merge

`sentry_issue` returns `deploy`, read from the facts:

- `verdict: last-deploy` — the issue was first seen in the release deployed
  on this environment, after it was deployed. `deploy.pull` is the merged
  pull request it came from.
- `verdict: earlier-deploy` — first seen in another release: an older change,
  or one a later deploy did not fix. `deploy.pull` is that release's pull
  request, when there was one.
- `verdict: unknown` — the issue carries no release, or the environment
  records no deploy. Read `github_read_workflow_runs` for the deploy workflow
  and the environment's `pipelineLog` to place it in time.

Check it against the person's report: the error started when they say, on
the route they named. If it does not match, say which part does not.

## 5. Decide, and make the move

**Revert — a deploy caused it.** `last-deploy`, or an `earlier-deploy` whose
pull request is still what production runs and whose change the stack
points at (a build or pipeline change, a dependency, a config the release
carried):

- The Release engineer opens the revert: `propose_action github.revert_pull`
  with `url` = `deploy.pull`, `recordId` = the environment's id, and a
  `reason` that names the issue, its events and the line that settles it.
  Confidence 0.9 when the verdict is `last-deploy`. It merges itself on green
  under its trust rule, and Undo puts the release back.
- Another seat (the PM, QA) does not revert: it files the incident (below)
  naming the pull request, and the Release engineer's watch picks it up.

**Fix forward — it is the code, and reverting would take back more than it
fixes** (the issue is old, the release carried other work people use, or no
pull request is behind it):

- File it as a bug: the request type's filing tool (`file_request`) with
  `kind: bug` (`incident` when people cannot use the product right now),
  `severity` (`p1` when signed-in use is broken), the product, a title that
  names what breaks for people, and `evidence.errors` — one entry per issue:
  `source: sentry`, `shortId`, `url`, `title`, `culprit`, `environment`,
  `release`, `firstSeen`, `lastSeen`, `events`, `request` ("GET <url> →
  500"), and `frames` (the app frames, mapped to repository paths). The
  engineer's contract carries them, so the fix starts from the stack.
- Recommend the fix in one line: the file, the line, and the change.

Filing for a revert too: when you revert, also file the incident (`kind:
incident`, the same `evidence.errors`), so the root cause is fixed after
production is back.

## 6. End with the record, the move and a link

Your answer is three lines, never a diagnosis alone:

1. What broke, for people: the issue's short id and link, its events since
   when, the line of the message that settles it, and the file and line.
2. Why: the verdict, with the deploy and pull request it names.
3. What you did: the revert or the bug request, by its link, and what
   happens next ("it merges on green; Undo puts the release back").

If you could not make the move (no credential, no environment record, the
action refused), say exactly why, in one line, and what would let it run.
