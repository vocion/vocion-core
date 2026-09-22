---
slug: ideate-from-evidence
name: Ideating from evidence
description: >-
  How the weekly ideas pass is done: what is read (feedback and store reviews,
  dogfood notes, the incumbent as the `product` record describes it,
  analytics when a source exists), how an idea is written so it survives the
  twenty-percent test, how it is deduped against every open request, and why
  it is filed as a `request` of kind `idea` and never as a task. Read on every
  weekly review before filing anything new.
playbooks: [the-twenty-percent, written-promises]
version: 1
---

# Ideating from evidence

An idea is a request nobody has filed yet. That is the only kind of idea this
factory builds from, and it is why every idea is filed as a `request` — with
`kind: idea`, `channel: internal`, `source: product-manager` — and enters the
same ranking, the same twenty-percent test and the same batch as anything a
customer wrote. An agent's idea is not a task. It is not a higher-priority
request. It is a request with weaker evidence than most, and it is written to
say so.

## What is read

In this order, because the first sources are people and the last is a
competitor:

1. **Feedback in the asker's words** — store reviews, support mail, chat,
   GitHub issues that reached the backlog this month, including the ones
   answered *no*. Three declined requests that each asked for a corner of the
   same thing are one idea nobody filed.
2. **Dogfood notes** — requests with `channel: dogfood`. The team knows what
   the product promised; their friction is the cheapest signal there is.
3. **The incumbent, as the product record describes it** — `incumbent.name`,
   `incumbent.comparePlan`, `incumbent.listPrice` with its `checkedOn` and
   `sourceUrl`. Read it for what people pay them for and where they are slow
   or expensive, never for a feature list to copy. The playbook is explicit:
   "the incumbent has it" is worth zero as evidence.
4. **Analytics — only when a source exists.** A PostHog or Sentry source in
   the workspace says where people drop out, what they retry and what errors
   they hit without ever filing a request. Cite figure, source and date. No
   source, no analytics claim.

Not read: the codebase, the roadmap, what would be fun to build.

## Dedupe before writing

For each candidate, compute the `dedupeKey` the way triage does — product plus
the thing asked for, normalised — and look for an open request with the same
key or the same surface. If one exists, the idea is not filed: the evidence you
found is added to the existing request's ranking reason instead, and its count
of askers goes up if the evidence was a person. An idea that duplicates a
declined request is filed only if the evidence is new, and the body quotes
the old `decisionReason`.

## How an idea is written so it survives the test

The `body` is written for the twenty-percent test, because that is the first
thing that will happen to it:

- **The job it serves**, in one sentence, named from the product's core job.
  An idea that cannot name the job is a feature looking for a reason; do not
  file it.
- **The evidence**, one line each with its source: the request ids, the
  dogfood note, the analytics figure with its date. Never "users want".
- **The promise it keeps or nears.** If it nears one, say which, and expect
  the recommendation to be a person's ruling, not a build.
- **What it does not do** — the incumbent's neighbouring feature it
  deliberately leaves out.
- **`sizeClass`** in release terms; a `major` idea waits on the initiative
  limit like any other.

`title` is the sentence a person would use asking for it. `theme` and `icp`
are set on filing. `askedBy` is `{ name: product-manager }`; `askedAt` is now.
`severity` is never set on an idea — an idea has value, not severity.

## At most five, and then the ranking

Five ideas a week is plenty; a sixth is filed next week if it still seems
true. Each is ranked by `rank-the-backlog` with everyone else's request. An
idea with one source and no asker lands in the 20–49 band and stays there
until a person asks for it — which is the test working, not failing.

## The receipt

Per pass: what was read (sources, dates), ideas filed with ids and the job
each serves, candidates dropped as duplicates and which request absorbed
their evidence, candidates dropped for failing the test and why.
