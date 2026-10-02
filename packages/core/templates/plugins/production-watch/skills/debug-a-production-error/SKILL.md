---
slug: debug-a-production-error
name: Debug a production error
description: >-
  Given an incident or a reported production error — a 500, a screenshot, a
  route, a time — read what Sentry recorded, map the stack to the
  repository, say what caused it from the evidence, and end with a move
  written on the incident — first saying whether it is still happening, so a
  fixed outage gets a summary, not a P1. Never ends in prose alone.
version: 2
---

# Debug a production error

Somebody saw production break, or the watch opened an incident. Your job is
not to explain what might be wrong. It is to read what production recorded,
say what caused it, and leave a move on the incident — in this turn.

## 1. Find the issue

- From an incident: its `shortId`, `project`, `environment`.
- From a report (a 500, a screenshot, a URL and a time): the project that
  served the failing host. `sentry_issues` with that `project` and
  `environment`, `around` the time the person saw it (with `window_minutes`),
  or `release` with `first_seen_in_release: true` for what a release brought.
  The top issue whose title or route matches what they saw is the one.

## 2. Read it

`sentry_issue` with the short id and the environment. Read:

- the exception type and the first lines of its message — they often say
  exactly what is wrong (a missing engine, a null field, a timeout);
- `appFrames`: drop the container root (`/app/`) and read a built path back to
  its source (`dist/auth/plugin.js` → `src/auth/plugin.ts`); name the file and
  line;
- the failing request (method, URL, status) and the breadcrumbs before it;
- `firstRelease` and `firstSeen`.

## 3. Is it still happening?

`sentry_issue` answers this first, as facts: `stillHappening.state`, the last
event against now, the minutes it has been quiet, and the releases that went
out since. Read it before you decide anything — an error a person asks about
is often one that is already over (2026-10-01: asked about an error at 14:45,
the answer filed a P1, queued an incident and drafted a P1 alert for an
outage a revert had fixed at 16:14; the last event was 15:47).

- **ongoing** — go on: what caused it, then the move (4).
- **stopped** — it is over. Say what it was, when it started and stopped,
  what caused it, and what fixed it (the release that went out after its
  last event, by name). File no request, open no incident, raise no alert,
  and put up no card for it. At most, suggest one follow-up in a line — a
  lasting fix the stopped one does not cover, or a check that would have
  caught it — and file it only when the person asks for it. If an open
  incident or request is about it, write that it is resolved and by what.
- **unknown** — count its events over the last hour (`sentry_issues` with
  `period: 1h`) before you act.

## 4. Say what caused it

- **deploy** — it first appeared in a release, soon after that release went
  out, and the stack or the message is about what the release changed (the
  build, its runtime, a dependency, a config). Name the release.
- **code** — an existing path fails on some input or state, whatever the
  release.
- **unknown** — the evidence does not settle it; say what would.

## 5. Decide and move (only while it is still happening)

- **deploy**: write it on the incident. With the software factory on, its
  Release engineer is woken by the incident and owns the revert.
- **code, major** (a model's judgment, yours: people see it, on a primary
  flow — signing in, the main page, saving or sending — and it keeps
  happening): with the software factory on, file one bug through the request
  type's filing tool (`file_request`): `kind: bug` (`incident` when people
  cannot use the product now), `severity` (`p1` when a primary flow is
  broken), the product, a title naming what breaks for people, a story with
  the exception line, the failing request, the app frames mapped to
  repository paths and the release, and `evidence.urls` with the issue's link
  and the incident's page. If a request for this issue already exists, add to
  it instead. Write its id on the incident (`requestId`).
- **code, minor** or **no factory**: write the recommended fix on the incident
  (the file, the line, the change).

## 6. End with the record, the move and a link

Update the incident (`update_object`): `action` in one line with its link,
and `cause`/`causeWhy` when you read it differently from the watch. Then
answer in three lines: what broke (with the link), why, and what was done.
If you could not make the move, say exactly why and what would let it run.
