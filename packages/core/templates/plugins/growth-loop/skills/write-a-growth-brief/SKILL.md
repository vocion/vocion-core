---
slug: write-a-growth-brief
name: Writing a growth brief
description: >-
  How to turn evidence of demand into a growth brief a producer can execute
  without asking a question and an analyst can judge months later: what one
  brief is, why the objective is a number and not a deliverable, how the single
  claim and its evidence are written, what belongs on the do-not-claim list and
  why it is the field that does the work, what the acceptance contract may and
  may not contain, how the measure, its baseline, its source and its attribution
  model are fixed before the work starts, and what to do when no source exists.
  Read before writing any brief, and when a returned deliverable shows
  assumptions the brief should have carried.
playbooks: [one-claim-per-piece, measure-before-you-make, publish-what-holds]
version: 1
---

# Writing a growth brief

A **brief** is the whole interface between evidence that somebody wants
something and the thing that gets made. The producer cannot see the
conversation, cannot ask a question, and will finish something whether or not
the brief was clear — so everything the brief leaves out comes back as an
assumption, a rewrite, or a claim nobody checked.

It is also the durable record the verdict is written on, months later. Write it
so somebody who was not there can judge it.

## One brief is one claim to one audience

Split on **audience** and on **claim**, never on format. The same claim as a
post and as an email is one brief with two deliverables; the same format
carrying two claims is two briefs.

A brief that needs a conversation to explain has not done its job.

## The objective is a number, not a thing to make

> Move demo requests from the pricing page from 4 a week to 10.

not

> Write a pricing FAQ.

The second is a `deliverable`. If the objective cannot be stated as a movement
in something countable, you do not yet know why you are making this, and the
honest output is the question that would settle it.

## `demandRef` — the evidence somebody wanted this

One line, in the workspace's own handle for it: the question people search for,
the objection that keeps coming back, the segment nothing covers, the request
that arrived three times. A brief whose `demandRef` is "we should probably have
one of these" is the brief to drop. When the software factory is also on and a
`request` asked for this, put its id in `requestId` — one intake noun, whatever
door the ask came through.

## `claim` and `claimEvidence` — the single thing, and what holds it up

`claim` is one sentence. `claimEvidence` is the list the piece may cite: links,
artifact ids, a figure with its **source and the date it was read**. The gate
checks the deliverable against this list and nothing else, which is what makes
"unsupported" a finding rather than an opinion.

Evidence gathered at brief time is evidence the producer does not have to go
find, and cannot get wrong.

## `doNotClaim` — the blast radius

This is the field that makes a brief a brief. A task contract bounds a worker by
the file paths it may touch; a brief bounds it by the claims it may make,
because that is where the damage is.

Be specific enough to check in one pass:

```yaml
doNotClaim:
  - No integration with an accounting ledger — the connector is not built.
  - No comparison against a named competitor's pricing; nobody has verified it this quarter.
  - Do not repeat the "teams ship 40% faster" figure; it has no source we can cite.
  - Do not name Northwind or any other customer. Say "a distribution customer".
  - No claim about response times; the only measurement we have is from a staging environment.
```

Write it from what has actually gone wrong: every retraction, every correction
and every gate rejection is a line for the next brief on that subject. A vague
line — "do not overclaim" — stops nothing and should not be written.

## `acceptanceContract` — fit to publish, not worth doing

Each line checkable by a person or a command without re-reading the whole piece.
This is the same field, doing the same job, at the same point in the work as the
software factory's task contract — deliberately, so a person reads one
vocabulary across both.

What it may contain: the claim is stated and supported in the opening; every
figure carries its source and date; both internal links resolve; the piece
answers the question in the reader's own words before defining anything; nothing
on the do-not-claim list appears.

What it may **not** contain: anything about whether the work succeeded. "Ranks
in the top ten" is not an acceptance line, it is the measure. Acceptance is a
gate at the moment of publishing; the outcome is a reading taken later, and
confusing the two is how teams end up with no outcome at all.

## `measure` — fixed before the work starts

```yaml
measure:
  key: pricing_page_demo_requests
  label: Demo requests from the pricing page
  unit: requests/week
  source: product analytics — the pricing-page form event
  attribution: last touch
  baseline: 4
  target: 10
readAfterDays: 28
```

Chosen after the fact, any piece looks like a success under some number. Chosen
first, it can fail honestly — which is the only way the loop learns anything.

**When no source exists**, say so. Write the brief with the measure's `source`
empty and expect the verdict `unmeasurable`; name the instrument that is missing
in the objective. Do not substitute a number somebody can read but nobody asked
for — a proxy nobody agreed to is worse than an honest gap.

## `claimClass` and `decisionCost` — what it costs a person

`claimClass` says what is on the other side of the claim being wrong, and the
`publish-what-holds` playbook says what each class needs behind it.
`decisionCost` is the minutes of a person's attention this brief will ask for
before it can go out, in the same units the software factory uses: 1 for a
descriptive piece somebody skims, 15 for a comparative claim somebody has to
stand behind, 60 for anything a regulator reads. The lead sums it across open
briefs against the day's budget, so ten cheap pieces cost a coffee and ten
expensive ones cost a week.

## `verifiedAgainst` — the staleness pin

What the claims were checked against, and when: a version, a release, a dated
reading of a source. A piece whose evidence was true of a different version is
now wrong, and without this nobody can tell which pieces to re-read when
something changes.

## `outOfScope` — say what you are not covering

Most rework comes from a brief that was silent rather than one that was wrong.
Two or three lines is enough.

## When not to write a brief

If the claim cannot be stated in one sentence, or the objective cannot be stated
as a number, or you cannot name a single piece of evidence that somebody outside
wanted this — do not write the brief. Write the question that would settle it,
and put it in front of a person.
