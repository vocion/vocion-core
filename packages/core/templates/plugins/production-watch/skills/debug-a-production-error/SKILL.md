---
slug: debug-a-production-error
name: Debug a production error
description: >-
  Given an incident or a reported production error — a 500, a screenshot, a
  route, a time — read what Sentry recorded, map the stack to the
  repository, say what caused it from the evidence, and end with a move
  written on the incident. Never ends in prose alone.
version: 1
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

## 3. Say what caused it

- **deploy** — it first appeared in a release, soon after that release went
  out, and the stack or the message is about what the release changed (the
  build, its runtime, a dependency, a config). Name the release.
- **code** — an existing path fails on some input or state, whatever the
  release.
- **unknown** — the evidence does not settle it; say what would.

## 4. Decide and move

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

## 5. End with the record, the move and a link

Update the incident (`update_object`): `action` in one line with its link,
and `cause`/`causeWhy` when you read it differently from the watch. Then
answer in three lines: what broke (with the link), why, and what was done.
If you could not make the move, say exactly why and what would let it run.
