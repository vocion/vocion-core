---
slug: mirror-the-tracker
name: Keeping the tracker in step with Work
description: >-
  Which state of a request maps to which status on the connected issue
  tracker, when the issue moves, what else is mirrored (the release as the
  issue's version, the factory pull request as a link) and what is never
  mirrored (the factory's own retries and bookkeeping). Read when a request
  that carries an issue URL changes state, when a release lands, and whenever
  someone asks why the board and Work disagree.
playbooks: [naming-the-work]
version: 1
---

# Keeping the tracker in step with Work

A client who filed an issue reads the board, not Work. The board is true when
it says the same thing Work says, a few minutes later. This skill is the
mapping and the discipline; `tracker.transition_issue`, `tracker.update_issue`
and `tracker.attach_file` are the moves, each done for you and each with Undo.

## Which requests are mirrored

Only a request whose `evidence.urls` carries an issue URL on the connected
tracker. A request born in chat or on a product site has no issue unless a
person asked for one; the factory does not file issues for its own convenience.
When a person does ask ("put this on the board"), `tracker.create_issue` files
it from the request in the asker's words, with the request named in the
description, and from then on it is mirrored like any other.

## The status map

Every tracker names its statuses differently, so the map is written in terms
of what the request's `state` means and the issue's status *category*:

| Request | What it means | Issue moves to |
|---|---|---|
| filed, triage not done | we have it | the first "to do" status (acknowledged, nothing else) |
| in scope, plan or build approved | we are building it | the project's "in progress" status |
| pull request open, QA running | it is being checked | the project's "in review" status when one exists; else stays in progress |
| released | it shipped | the project's "done" status |
| out of scope, answered, duplicate | it will not be built | the project's "won't do" or "closed" status, never "done" |
| deferred | later, with a date | stays where it is; the date goes in a comment through `tell-the-requester` |

Read the transitions the issue actually offers (`tracker_read_issue` lists
them) and pick by name against this map. A status the project does not have
is not invented: say so once on the request and leave the issue where it is.

## What else is mirrored

- **The release**: when the request's `releaseId` is set, `fixVersion` (or the
  tracker's equivalent) takes the release's `version`.
- **The pull request**: when the task's `prUrl` is set, a remote issue link
  to it, titled with the pull request's title.
- **The mockup and the after-shot**: the designer attaches them
  (`close-with-the-after-shot`); the PM does not duplicate that.
- **Priority**: only when the product owner has said the board's priority is
  the factory's. Otherwise `priority` on the request is ours and the board's
  is theirs, and they may disagree.

## What is never mirrored

A retry the factory made on its own, an attempt QA sent back, a worker run
that failed and was queued again, a plan that was rewritten: these are the
factory's own bookkeeping. A board that shows every internal move is a board
nobody reads. The issue sees the state changes above and the comments a
person released, nothing else.

## When they disagree

Work wins. If the issue was moved by a person on the board, read it back
(`tracker_read_issue`) and say on the request what the board now says; do not
move it back. A person moving an issue to done that Work says is building is
a question for that person, filed as an ask, not a transition.
