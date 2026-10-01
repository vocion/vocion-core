---
slug: intake-from-the-tracker
name: An issue on the tracker becomes a request
description: >-
  How an issue a client filed on the connected issue tracker (Jira first;
  Linear, Azure Boards and others later) becomes exactly one request, or is
  matched to the one that already covers it: the issue read live rather than
  from the index, its key kept on the request as evidence, the reporter as the
  asker, and one request per issue. Read whenever an issue key or issue URL is
  the thing being asked about, and before `file_request` is called for it.
playbooks: [naming-the-work]
version: 1
---

# An issue on the tracker becomes a request

The index holds one document per issue: key, summary, status, description,
refreshed hourly. That is enough to find an issue and not enough to act on
one. Before a request is filed from an issue, the issue is read live.

## Read it live

`tracker_read_issue` with the key. It returns every field, the comments in
order, the attachments and the status transitions available from where the
issue stands. The comments are where the ask was sharpened: a reporter who
wrote two lines in the description often wrote the real acceptance in a
reply. An attachment worth seeing is read with `tracker_read_attachment`.

A search for the issue behind a vague mention is `tracker_search_issues` in
the tracker's own language (JQL on Jira); it is bounded to the configured
projects, so a query never leaves them.

## One request per issue

`lookup_objects` for a request whose `evidence.urls` carries this issue's
URL. There is one or there is none:

- **One**: it is the request. Read it, and if the issue has moved on (a new
  comment, a changed status), write what changed on the request
  (`update_object`) and stop. Never a second request for the same key.
- **None**: dedupe against open requests on the same product by `dedupeKey`
  and surface (`triage-request`). A match is a duplicate: `duplicateOf` set,
  the issue URL added to the original's `evidence.urls`, and the reporter told
  on their issue when the original's asker is told.

## File it

Call `file_request` (see `surface-an-ask-as-a-card`). What the tracker decides:

- `channel: tracker`.
- `askedBy`: the reporter's `name`, their account id as `externalId`, their
  `email` when the tracker gave one.
- `body`: the issue's description as written, then the comments that changed
  the ask, each with its author and date. The `title` is yours; the body is
  theirs.
- `evidence.urls`: the issue's URL first (its key is in it), then any link the
  description carried. `evidence.screenshotArtifactIds`: attachments you read.
- `severity` from the issue's priority only when the project uses priority to
  mean severity; otherwise judge it as `triage-request` says.
- `askedAt`: the issue's created time.

## Keep the key on both sides

The request carries the issue URL; the issue carries the request. Propose
`tracker.update_issue` with `remoteLink: { url, title }` pointing at the
request's page, so whoever opens the issue finds where the factory is with it.
Done for you; Undo removes the link. The status mirror from here on is
`mirror-the-tracker`.
