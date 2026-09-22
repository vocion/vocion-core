---
slug: rank-the-demand
name: Ranking what to brief next
description: >-
  How the queue of briefs is ordered and bounded: the three inputs a rank is
  scored on and the ones it is not, why a closed brief's verdict outranks a
  fresh idea, the three limits that decide whether anything is promoted at all
  (decision minutes, spend, one big bet), how a theme or channel is stopped after
  two no-effect verdicts, and why the reason is written on the record beside the
  rank. Read before promoting anything, and whenever the backlog has grown faster
  than the readings.
playbooks: [measure-before-you-make]
version: 1
---

# Ranking what to brief next

The backlog is unbounded and cheap. The queue in front of a person is bounded
and expensive. Ranking is the promoter between them.

## Three inputs, and nothing else

1. **The demand it answers** — how many people outside asked, how specific the
   ask was, and whether anything of ours already answers it.
2. **What the closest closed briefs returned** — the verdicts on briefs in the
   same theme and channel. This input is the reason the loop is a loop. A fresh
   idea with no evidence ranks below a repeat of something that measurably
   worked.
3. **What it is expected to cost** — `estimateCents` and `decisionCost`
   together. A brief that costs a person an hour is not comparable to one that
   costs them a minute, whatever it returns.

Not inputs: how interesting it is, how recently somebody mentioned it, who
asked, how long it has sat there. A brief you cannot give a reason for stays
unranked, and the page shows it as unranked rather than guessing.

## Write the reason on the record

One to three sentences naming which input moved the rank and by how much: the
count of people who asked, the verdict of the nearest closed brief with its
date, the expected cost. A rank without this is not written.

## The three limits

Ranking says what is next. These say whether anything goes at all.

**Decision minutes.** Sum `decisionCost` over every brief waiting on a person
against the day's budget. When promoting another would take the day past it, the
brief waits and the report says which limit held it. This is the limit that
protects the only genuinely scarce resource in the loop.

**Spend.** Read the budgets core holds. Never keep a second ledger of what
things cost, and never assert a figure you did not read this turn.

**One big bet.** At most one brief whose `claimClass` is `comparative`,
`performance` or `regulated` is in flight at a time. These are the ones that
take a person's real attention and the ones a retraction costs most. A second is
an ask naming both, never a quiet decomposition into two smaller ones.

## Stopping

A theme or channel whose closed briefs came back `no_effect` twice is not
briefed again without new evidence. Say so when you drop it, name the two
verdicts, and leave the note on the theme so the next pass does not rediscover
it.

This is the step teams skip. Without it the loop is a queue with extra
paperwork.
