---
slug: triage-request
name: Triaging a request
description: >-
  How a request — a bug report, a store review, a support email, a chat
  message, an incident, a dogfood note — is read once and ends in exactly one
  of three places: an engineering task, an honest written answer, or a link to
  the open request it duplicates. Covers deduping against open requests,
  tagging product, kind, severity and risk, the scope decision, and why
  the reply is itself a gated action. Read whenever a request is `new`, and
  before writing any task contract from one.
playbooks: [naming-the-work]
version: 2
---

# Triaging a request

Every request is answered. Not every request is built. Triage is the one pass
that decides which, and it ends in **exactly one** of three outcomes:

1. **A task** — the request is in scope; the PM puts the build in front of a person with its id.
2. **An honest answer** — it will not be built, or it is a question; draft the
   reply in the asker's terms.
3. **A duplicate link** — an open request already covers it; link, tell the
   asker, close this one.

A request that ends in none of these is still open, and the seven-day clock is
still running on it.

## Read it as it arrived

**The asker is the person talking to you**, unless they say they are relaying
someone else. A request that arrives in chat is filed with that person as
`askedBy` and the chat as its `channel` — never "who should I attach this to?"
(2026-09-24: an incident answer named the release, the rollback and the risk,
then asked who the asker was, and filed nothing). File first; ask only what
the record cannot already answer.

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

## Then check the gap is still there

Dedupe asks whether another RECORD covers this. This asks whether the PRODUCT
already does. They are different questions and both have to be answered before
anyone plans anything, because a request describes what was true on the day it
was asked and a product that ships most days makes that perishable.

Go and look. The route, the screen, the endpoint, the file — whatever the ask
names. Reading another request is not looking; neither is remembering.

Record it in `gapCheck` as one of three findings, with `how` naming what you
actually looked at and `checkedAt` stamped:

- **`add`** — none of it exists. This is the only finding that lets work
  start.
- **`modify`** — part of it already ships. Narrow the request to the part that
  does not: rename it and rewrite its story so it asks for that alone, then
  check the narrowed ask and record the new finding. A half-true request
  builds the wrong thing.
- **`none`** — it all ships. Close it with an honest answer saying where it
  landed and when, in the asker's own terms. Nobody wants it built twice.

The check is good for fourteen days. A request that has sat longer than that
is checked again before a worker is sent at it — which is what makes this part
of a REPLAN and not only of a first plan.

You will be refused at the write if you skip it: a request cannot enter
`in_scope` or `building` without a fresh `add`. That refusal is structural
(`libs/actions/gapGate.ts`) and it is not negotiable from inside a prompt.

**This is not hypothetical.** On 2026-09-24 two of the first rows read off the
production board had already shipped — an appearance setting that was in the
account menu and on ⌘K, and a "send/share on the file page" request whose
share half had landed six days earlier while only the send half was ever
missing.

## Tag it

- **`why`** and **`whyNote`**, REQUIRED, and the first thing you write. One
  or more reasons from the closed list, never a number: `user_request`,
  `production_bug`, `blocks_goal`, `breaks_promise`, `required_for_dogfood`,
  `manual_toil`, `platform_leverage`, `factory_reliability`,
  `observed_behaviour`. A priority of 62 explains nothing; `user_request` plus
  `required_for_dogfood` explains everything a person needs in order to argue
  with you. `whyNote` grounds the codes in this record's own evidence in one
  short line, naming the countable thing behind the code: not "it is a user
  request" but "Chris and two dogfood users asked on 2026-09-20".
  **If you cannot name a reason from the evidence on the record, you have not
  understood the request.** Leave it `new`, say what evidence is missing, and
  do not tag it. An invented reason is worse than a blank one, because the
  whole value of the field is that a person can trust it. Never derive a
  reason from a request's status, its age or its title.
- **`kind`** — bug, gap, idea, incident, question. Be literal: something
  promised that does not work is a bug even when the asker calls it a feature
  request.
- **`product`** — the slug. A request that fits no product is the first sign
  it is out of scope; do not invent a product to hold it.
- **`severity`** — bugs and incidents only. `p1` means people cannot use what
  was promised; it goes straight to a contract tonight, no scope decision.
- **Risk** — read the product's `repos` and their `riskDefaults`: where would a
  fix land, and what class does that path demand? This is what the contract
  will start from, and it is what decides whether the eventual merge is a
  minute of someone's day or a real decision.
- **`sizeClass`** — in release terms, not effort: `major` is a new capability
  or product and counts against the initiative limit of one in flight;
  `minor` is a feature within a product; `patch` is a fix. A `major` request
  in scope while an initiative is open waits on the backlog and is said so.
- **`decisionCost`** — minutes of a person's attention the decision this will
  ask for will take. A reply to a question, 1. A merge of a docs fix, 1. A
  merge of a logic change, 5. Anything that touches a price, a plan limit, a
  promise or an architecture, 60.

## In scope or not

Before deciding, read the wiki pages tagged `principles` (`read_wiki_page`;
the index names them) — the design principles, the written promises and the
AI-first requirement are the tie-breakers, and a scope decision that never
read them is a guess.

One question, answered honestly: **does this serve the job the product does
for people, inside the promises it has made and the operating intent the
workspace states?** Value is measured against the product's `promises` and the
workspace goal, not against how easy it is or how nicely it was asked. The
operating intent's constraints are refusals, not preferences.

- **Yes** → `state: in_scope`, and the build goes in front of a person as a
  card with the request id AND its `why`; the contract is written once they
  say yes, and the task inherits the reason.
- **No** → `state: out_of_scope`. Draft the honest answer.
- **Cannot tell** → it is a question for a person, with the request, your
  reading and the two ways it could go. Do not park it as `triaged` and move
  on; that is the gap the mission exists to close.

A P1 bug skips the decision. An incident skips it. Everything else is decided.

**Name the platform piece, and add to core when it is missing.** Every in-scope
decision says which shared capability it uses or extends (the wiki page tagged
`platform` lists what core is). When the request needs a capability every
product would need and that page does not have — a share-link rule, a seat
rule, a notification path, an import — add ONE line to that page's
"Candidates for core" section as part of the same turn (`write_wiki_page`):
the date, the capability in a sentence, the request id, the products it would
serve. That is the mechanism (Chris, 2026-09-25) by which the platform's
feature set is maintained while planning, not afterwards; a candidate nobody
adds while deciding is a package nobody extracts.

## The honest answer

Written for the person who asked, in their terms, saying what was decided and
why — never "we will consider it", never "on the roadmap" for something that
is not. If the reason is a promise the product made elsewhere, quote the
promise. If the reason is that it does not serve the goal, say what the goal
is. Short.

**The reply is a gated action.** Propose it (`notify.requester` — the same action that later tells an asker their request shipped); a person
releases it. It goes back on the channel the request came from — the reviewer
who wrote a store review reads it in the store, the person who emailed reads
it in mail. Never say a reply was sent that is still waiting on a person.

## The receipt

One line per request triaged: id, `why` codes, kind, product, the outcome
(task / answer / duplicate of #n), and the decision cost. Then one line for
anything you could not place and why, and a separate count of the requests you
left untagged because the evidence named no reason. That count is a real
number a person should see, not a failure to hide.
