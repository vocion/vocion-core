---
slug: rank-the-backlog
name: Ranking the backlog
description: >-
  How a product's open requests are scored and ordered: against the product's
  written promises, the operating intent, how many real people asked, and
  evidence from an analytics source when one exists — with the score and its
  reasons written on the request (`priority`, `priorityReason`, `rankedAt`).
  Covers what counts as evidence and what does not, how ties break, and when a
  ranking is stale. Read before recommending anything to a person, and
  whenever a person asks what to build next.
playbooks: [naming-the-work]
version: 1
---

# Ranking the backlog

The backlog is unbounded and cheap; the asks in front of a person are bounded
and expensive. Ranking is what decides which few, and it is only worth doing
if the reasons are written where the next reader can check them.
A score without a reason is a feeling with a number on it.

## What is ranked

Every `request` in an open state — `new`, `triaged`, `in_scope` — for one
product at a time. A request with no `product` is not ranked; it is a question
for a person. A `p1` bug or an `incident` is not ranked either: it is already
a contract tonight, and putting a score beside it would only suggest it
could wait.

## The four inputs, and nothing else

0. **Before the four: the workspace's operating intent, when it states one.**
   Its priority list is a person's own ranking, and it settles a tie the four
   inputs leave open, and it overrules them when they disagree, because a
   score is an argument and the list is an instruction. Name the rule that
   moved a request. Its constraints are refusals: a request that would cross
   one does not rank, it becomes an ask quoting the constraint. Its budget
   advises and is not enforced, so never report a request as blocked by it.
   Where no intent is stated, say you are ranking without one.

1. **The product's promises** (`product.promises`). A request that would *keep* a promise people
   are currently finding broken ranks first. A request that would *strain* one
   ranks last, whatever else is true, and its reason says which promise.
2. **The job the product does.** Does this serve the core job the product
   does for people, or something beside it? Yes is worth a lot; no is worth
   nothing, and the honest answer to the request is the recommendation, not a
   low score that leaves it in the queue.
3. **How many real people asked.** Count the request and every request whose
   `duplicateOf` points at it. The same person asking twice counts twice. A
   store review counts the same as a dogfood note. A comparison chart, a
   competitor's feature list and "the incumbent has it" count zero: nobody
   who uses the product asked.
4. **Analytics evidence — only when a source exists.** If the workspace has a
   PostHog or Sentry source, read it: how many people reach the surface the
   request is about, how often the error it describes fires, dated. Cite the
   figure, its source and the date in the reason. If no such source exists,
   the reason says "no analytics source" and the score rests on the other
   three; never quote what such a source "usually" shows.

The request's `why` is not a fifth input and does not raise a score: it is the
record of what triage believed, and you audit it against the same evidence you
rank on. A request with no `why` is not ranked at all: report it as untagged
and send it back to triage rather than scoring something nobody can justify.

Effort, how interesting the work is, who asked, and how nicely they asked are
not inputs. `decisionCost` is not an input either — it meters the batch, it
does not rank it.

## The score

`priority` is an integer 0–100, written on the request with `priorityReason`
(one to three sentences naming which of the four inputs moved it and by how
much) and `rankedAt`. The bands, so two products' backlogs read the same way:

- **80–100** — keeps a promise people are finding broken, or is in the core
  job and three or more people asked.
- **50–79** — in the core job; one or two people asked; or the analytics show
  the surface is used and the request would make it better.
- **20–49** — plausibly in the core job, one asker, no analytics evidence.
- **0–19** — outside the core job, or strains a promise. The recommendation
  for this band is almost always *answer* or *decline*, not a low rank.

Within a band, more askers wins; then the older `askedAt`; then the smaller
`decisionCost`. Say which tie-break decided it when it mattered for the top
ten.

## When to re-rank

Every weekly review re-ranks every open request for every product, whether
or not anything changed — a stale `rankedAt` is how a person knows the score
is old. Re-rank one product outside the cycle only when its promises change,
a duplicate is linked (the count moved), or a release closes requests (the
backlog under it moved). A request rejected in a batch keeps its score and its
`decisionReason`; it is not re-ranked to sneak it back in.

## The receipt

Per product: requests ranked, the top ten with score and one-line reason each,
what you could not rank and why, and whether an analytics source was read.
