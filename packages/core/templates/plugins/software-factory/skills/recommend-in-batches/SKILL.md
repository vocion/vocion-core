---
slug: recommend-in-batches
name: Recommending in batches of ten
description: >-
  How the ranked backlog becomes decisions: at most ten asks of kind
  `recommendation` for the accountable person, sharing one group key so they
  are decided as one sheet — then a pause until every one is decided. Covers
  the shape of each ask (the request, the proposed outcome, the decision cost,
  the evidence), what is written on the request when a decision lands, where
  each outcome goes next, and why a rejected request stays out of the next
  batch. Read before filing any recommendation and whenever a decision on one
  arrives.
playbooks: [the-twenty-percent, written-promises]
version: 1
---

# Recommending in batches of ten

A ranked backlog of two hundred requests is information. Ten questions a
person can answer from a phone are decisions. This skill is the step between,
and the number ten is the whole point: a person who is handed everything
decides nothing, and a person who is handed ten decides ten.

## The rule

**At most ten open recommendations at a time, and no new batch while any of
the last one is undecided.** Not eleven because one was easy. Not a second
batch for a second product. When a batch is old, the daily check names who it
is waiting on and for how many days, on the board, plainly — the person is the
bottleneck by design, and the honest thing is to say so rather than route
around them.

## Assembling a batch

Only when no ask of kind `recommendation` filed by `product-manager` is open.
Take the top of the ranking (`rank-the-backlog`) across every product, skip
anything with a `decisionReason` from a rejected recommendation, and stop at
ten or at the day's decision budget — the sum of the ten requests'
`decisionCost` should fit inside the sixty minutes `close-the-gap` meters,
because these asks sit in the same queue as the merges.

Each batch has one `groupKey` — `software-factory:batch/<YYYY-MM-DD>` — and a
`groupTitle` a person would recognise in a list: "Product recommendations —
21 Sep". The asks are decided as one sheet, one question per screen.

## The shape of one ask

Filed as an ask (docs/entities/ask.md), `kind: recommendation`,
`agentSlug: product-manager`, `teamSlug: software-factory`, `risk` from the
request's likely risk class (`low` for docs and copy, `medium` for a feature,
`high` for anything near a promise), `sourceRef:
software-factory:recommendation/<requestId>` so a re-file updates rather than
doubles, `contextUrl` the request's own page.

- **Title** — the question, under eighty characters, in the asker's terms:
  "Build the CSV export three people asked for?"
- **Body** — under four hundred characters: the request id or ids (a merge
  names both), the outcome you propose, the `decisionCost` in minutes, and
  the evidence in one clause each — "3 askers (#41, #57, #63) · in the core
  job · PostHog: 412 people reached export last month (read 2026-09-20) · no
  promise touched".
- **Options** — always these four, one of them `recommended` with your
  `confidence`:
  - `build` — the planner writes the contract; the request goes `in_scope`.
  - `answer` — it will not be built, or it is a question; the honest answer
    goes back on the asker's channel.
  - `decline` — the same as answer, when the reason is the twenty-percent
    rule or a promise; the answer quotes it.
  - `merge` — it duplicates an open request; the body names which.
- **Details** (`contextMd`) — the `priorityReason`, the promises read, the
  analytics figure with its source and date, and the request's own words.

On filing, write `recommendedAt`, `recommendationBatch` (the group key),
`recommendedOutcome` and `recommendationState: proposed` on the request, so
the Recommendations page shows the batch from the record and not from memory.

## When a decision lands

The `product-batch-decided` automation fires on `ask.decided` for your asks.
For the one ask decided, write on its request: `recommendationState`
(`approved` when the chosen option is your recommended one or any of the four
outcomes; `rejected` on a reject), `decidedAt`, and the person's note as
`decisionReason`. Then route it:

- **Approved build** → `state: in_scope`. The planner's next tick writes the
  contract; you do not. The request's `taskIds` fill in from there.
- **Approved answer or decline** → draft the `answer` in the asker's terms,
  quoting the promise or the rule; `state: out_of_scope`. `tell-the-requester`
  proposes the reply (`notify.requester`); a person releases it; you never say
  it was sent.
- **Approved merge** → `duplicateOf` the request named in the body; the
  duplicate's count on the surviving request just went up, and the asker is
  told where it stands, once.
- **Rejected** → the note is the reason, written on the request as
  `decisionReason`. The request stays open, keeps its score, and **is left
  out of the next batch** — a person said no, and asking again next week is
  not a new recommendation, it is nagging. It may return when the evidence
  changes (a new asker, a new figure), with a new `sourceRef` suffix and the
  old reason quoted in the body.
- **"Other" with a note** → `followUp` is set; read the note before anything
  else in the fire. It usually means "build, but smaller" or "ask me again
  after X" — write what it means on the request and do that.

When every ask in the batch is decided, and only then, assemble the next.

## What this is not

Not a proposal (`propose_action`): nothing executes when an ask is decided;
the answer *is* the outcome, and you read it back. Not authorization by the
agent: the `product.authorize.<class>` trust rules say which classes could one
day be released on the ledger's evidence, and until core registers those
actions every class is a person's answer. Not a way to skip the planner: an
approved build is a request the planner now owes a contract, nothing more.

## The receipt

Per fire: batch open or none; asks filed with request ids and proposed
outcomes; decisions landed since the last fire and where each went; who the
batch is waiting on and for how many days.
