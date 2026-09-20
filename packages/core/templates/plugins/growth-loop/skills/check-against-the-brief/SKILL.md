---
slug: check-against-the-brief
name: Checking a deliverable against its brief
description: >-
  The editor's procedure: what is read and what is deliberately not, the cheap
  order (do-not-claim, then acceptance, then every claim against the evidence,
  then the staleness pin), why one do-not-claim hit ends the read, the three
  verdicts and the three-fix limit, why the round is recorded, what an
  adversarial second read adds and when it is worth one, and why "I could not
  establish this" is a complete finding. Read before grading anything, and
  before letting something through because the deadline is close.
playbooks: [publish-what-holds]
version: 1
---

# Checking a deliverable against its brief

You are deciding one thing: **is this fit to publish**. You are not deciding
whether it was worth making — that is a reading taken weeks from now, by
somebody else, and nothing you do here can answer it.

## Read against the brief, not against your taste

The acceptance contract is the list you decide on. A finding that does not map
to a line of the brief is a note for the strategist, or it is nothing.

## The cheap order

Fail fastest where failure is cheapest.

**1. The do-not-claim list.** One hit is a rejection, whatever the rest of the
read says. Quote the forbidden line and the sentence that broke it, record it in
`gate.doNotClaimHits`, and stop. Do not continue to the acceptance contract to
be thorough; the piece is coming back regardless and every extra finding delays
it.

**2. The acceptance contract.** Line by line, in the brief's order. A line you
cannot check is a finding **about the brief** — record it as a fix and say so,
because the next brief on this subject should not carry an uncheckable line.

**3. Every claim against `claimEvidence`.** Anything the piece asserts that the
brief's evidence does not hold up is `unsupported`, quoted verbatim into
`gate.unsupportedClaims`. This is the finding that becomes a retraction, so it
is the one you are slowest and most literal about. A citation that exists but
does not say what it is cited for is unsupported, not supported.

**4. The staleness pin.** Is the piece consistent with `verifiedAgainst`, and is
that still current? A piece whose facts were true of an older version is wrong
now.

## Three verdicts, and no score on its own

- `publish` — every acceptance line holds, no do-not-claim hit, no unsupported
  claim. It may still be improved; that is not your call.
- `revise` — it can be fixed with at most three changes. Say which three, in
  order.
- `reject` — the claim does not survive, or the brief was not executable. Say
  which, because those go to different people.

A numeric score on its own invites averaging. If the workspace wants dimensions,
they sit beside the verdict, never instead of it.

## Three fixes, ordered

At most three. A list of nine is a rewrite, and a rewrite is a new brief, not a
revision. Ordering matters: the producer will do them in order and may run out
of time.

## Record the round

`gate.round`, counted from 1. This is the number the team learns from. A piece
that passed on the third read is a brief that was unclear; a first-read pass
rate that falls is a brief field that stopped being filled in. Reporting the
verdict without the round hides where the problem actually is.

## The adversarial second read

Where the workspace gives you a second model — ideally a second vendor — run the
read again there and say which you used in `gate.readBy`. A grader that shares
the author's blind spots is not an adversary, and a model reading its own
family's output is the most common way a clean grade means nothing.

Worth it for `comparative`, `performance` and `regulated` claims, and for
anything with a named customer in it. Not worth it for a descriptive piece
nobody will argue with.

Read as somebody looking for a reason to distrust it: which sentence gets
screenshotted, which comparison does not survive one check, which number has no
source.

## Ungraded is not passed

A piece that reached you late and unread is `revise`. "I could not establish
this" is a complete finding and always better than a pass you cannot defend. You
are not measured on how much you let through; nothing here is improved by a
faster gate that misses things.
