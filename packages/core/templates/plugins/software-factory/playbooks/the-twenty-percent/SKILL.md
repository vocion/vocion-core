---
slug: the-twenty-percent
name: The twenty percent
description: >-
  The standing rule for what gets built: the core job, done really well, and
  nothing that a real user did not name. "Missing" is a decision, not a gap.
  Attached to triage and contract writing so every request is judged against
  it before a task exists.
version: 1
---

# The twenty percent

A product that does one job really well beats a product that does the
incumbent's forty jobs adequately. We build the twenty percent of the incumbent
that carries most of its value, and we build it better than they do — faster,
simpler, cheaper, kept true. Everything else is not on the list, and that is
the point of the list.

## "Missing" is a decision, not a gap

When someone asks for a feature the incumbent has and we do not, the default
answer is that its absence was chosen. Say so, in the honest answer, and say
why: what the core job is, and why this is not it. A feature we never built
costs nothing; a feature we built to stop one request costs every user who did
not want it, forever.

## The only gaps closed are the ones a real user named

A gap is real when a person using the product — not a comparison chart, not a
review of a competitor, not a plan — asked for it in their own words, and the
request has an id. Two people asking is a signal; the same person asking twice
is a signal; a planner noticing that the incumbent has it is not. This is why
every task carries a `requestId` and why triage dedupes before it tags: the
count of real people is the only evidence that a gap exists.

## A feature request is never a reason to become the thing being replaced

The incumbent got to forty jobs one reasonable request at a time. Each one made
sense; the sum is why people are leaving. When an in-scope request would move
the product toward the incumbent's shape — another tier, another mode, another
setting — the answer is a question for a person, not a task, and the question
names the promise it would strain.

## In practice

- Triage asks one question of every idea and gap: is this in the twenty
  percent? Yes → planner. No → honest answer. Cannot tell → a person.
- Bugs and incidents skip the question. Something promised that does not work
  is always in scope.
- A contract's objective names the job it serves. An objective that cannot
  name the job is a feature looking for a reason.
