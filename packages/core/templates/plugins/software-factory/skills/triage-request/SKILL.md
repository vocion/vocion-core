---
slug: triage-request
name: Triaging a request
description: >-
  How a request — a bug report, a store review, a support email, a chat
  message, an incident, a dogfood note — is read once and ends in exactly one
  of three places: an engineering task, an honest written answer, or a link to
  the open request it duplicates. Covers deduping against open requests,
  tagging product, kind, severity and risk, the twenty-percent test, and why
  the reply is itself a gated action. Read whenever a request is `new`, and
  before writing any task contract from one.
playbooks: [the-twenty-percent, written-promises]
version: 1
---

# Triaging a request

Every request is answered. Not every request is built. Triage is the one pass
that decides which, and it ends in **exactly one** of three outcomes:

1. **A task** — the request is in scope; hand it to the planner with its id.
2. **An honest answer** — it will not be built, or it is a question; draft the
   reply in the asker's terms.
3. **A duplicate link** — an open request already covers it; link, tell the
   asker, close this one.

A request that ends in none of these is still open, and the seven-day clock is
still running on it.

## Read it as it arrived

The `body` is the asker's own words. Read them before the summary, before the
product guess, before anything. The `channel` tells you how much context they
had: a store review was written in thirty seconds with no idea of a roadmap; a
dogfood note came from someone who knows what the product promised.

## Dedupe first

Compute the `dedupeKey` — the product plus the thing that is broken or asked
for, normalised — and look for an open request with the same key or the same
surface. The third person reporting one broken button is the same request as
the first, and linking them is worth more than a third task: the count is what
tells the promoter the button matters.

When it is a duplicate: set `duplicateOf`, tell the asker on their channel that
it is known and where it stands (that reply is an answer, and it is gated like
one), and stop.

## Tag it

- **`kind`** — bug, gap, idea, incident, question. Be literal: something
  promised that does not work is a bug even when the asker calls it a feature
  request.
- **`product`** — the slug. A request that fits no product is the first sign
  it is out of scope; do not invent a product to hold it.
- **`severity`** — bugs and incidents only. `p1` means people cannot use what
  was promised; it goes straight to the planner tonight, no twenty-percent test.
- **Risk** — read the product's `repos` and their `riskDefaults`: where would a
  fix land, and what class does that path demand? This is what the planner
  will start from, and it is what decides whether the eventual merge is a
  minute of someone's day or a real decision.
- **`decisionCost`** — minutes of a person's attention the decision this will
  ask for will take. A reply to a question, 1. A merge of a docs fix, 1. A
  merge of a logic change, 5. Anything that touches a price, a plan limit, a
  promise or an architecture, 60.

## The twenty-percent test

One question, answered honestly, against the `the-twenty-percent` playbook:
**is this in the twenty percent of asks that carry most of the value against
the standing goals?** Value is measured
against the product's promises and the workspace goal, not against how easy it
is or how nicely it was asked.

- **Yes** → `state: in_scope`. Hand to the planner with the request id; the
  planner writes the contract, never you.
- **No** → `state: out_of_scope`. Draft the honest answer.
- **Cannot tell** → it is a question for a person, with the request, your
  reading and the two ways it could go. Do not park it as `triaged` and move
  on; that is the gap the mission exists to close.

A P1 bug skips the test. An incident skips the test. Everything else takes it.

## The honest answer

Written for the person who asked, in their terms, saying what was decided and
why — never "we will consider it", never "on the roadmap" for something that
is not. If the reason is a promise the product made elsewhere, quote the
promise. If the reason is that it does not serve the goal, say what the goal
is. Short.

**The reply is a gated action.** Propose it (`request.answer`); a person
releases it. It goes back on the channel the request came from — the reviewer
who wrote a store review reads it in the store, the person who emailed reads
it in mail. Never say a reply was sent that is still waiting on a person.

## The receipt

One line per request triaged: id, kind, product, the outcome (task / answer /
duplicate of #n), and the decision cost. Then one line for anything you could
not place and why.
