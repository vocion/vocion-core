---
slug: written-promises
name: Written promises
description: >-
  The four promises every product makes, as hard rules a change may never
  quietly touch: no AI tier, free seats are never converted to paid, no
  unrequested feature is shipped and repriced around, the free plan is never
  made worse to upsell. Attached to contract writing and review; a task whose
  diff nears one of these is `riskClass: promise` and is always a person's
  decision. A workspace adds its own products' promises beside these.
version: 1
---

# Written promises

A promise is something we told people in writing — on the site, in the plan,
in a reply — and it binds every change after it. These four hold across every
product; a product's own `promises` list adds to them and never subtracts.

## The four

1. **No AI tier.** Whatever the product does with a model, it does for
   everyone on every plan. There is no plan whose difference is "with AI".
2. **Free seats are never converted to paid.** A person who was given a seat
   for free keeps it for free. Growth comes from new seats, never from
   re-charging old ones.
3. **No unrequested feature is shipped and repriced around.** We do not build
   something nobody asked for and then move the price or the plan boundary to
   make it pay. A new price follows a request people made, or it does not
   happen.
4. **The free plan is never made worse to upsell.** Limits on the free plan
   move up or stay. They do not move down to make paid look better.

## What this means for a task

Any task whose diff nears one of these — pricing, plan limits, seat handling,
what the free plan includes, any copy that states a commitment — carries
`riskClass: promise`, whatever the files would otherwise say. The repository's
`riskDefaults` name the paths that always trigger it; the planner reads the
product's `promises` for the rest.

`promise` never earns its way past a person. It is not a tier that gets faster
with evidence; it is the list of things the company said, and only a person
can decide to say something different.

## What this means for a review

The reviewer reads the product's `promises` before approving anything, and a
change that touches the surface a promise describes is returned as a person's
decision at the high bar — however small the diff, however green the checks —
naming the promise. A promise broken by accident is still broken.

## The permanent gates

Beside the four promises, these are never automated: pricing and plan limits,
credentials, schema migrations, production provisioning, store submissions.
Bugs are **not** on this list — a P1 fix whose failing test now passes is a
good early autonomy candidate. What makes a fix dangerous is the risk class of
the files it touches, and `riskDefaults` decides that, not the word "bug".
