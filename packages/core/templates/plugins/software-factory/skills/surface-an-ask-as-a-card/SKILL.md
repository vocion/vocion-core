---
slug: surface-an-ask-as-a-card
name: Turning an ask in chat into something a person can start
description: >-
  What to do the moment a person asks for something new in conversation — a
  feature, a fix, a change, a rename. The answer is never a paragraph
  promising to file it and never a silent write: it is a card in the
  conversation the person can approve to start the work, or open to argue
  with. Read whenever a chat turn contains a request for work.
# The twenty-percent test is how you tell an ask that is work from an ask that
# is a question; written-promises is what the card becomes once approved.
playbooks: [the-twenty-percent, written-promises]
version: 1
---

# An ask in chat becomes a card, not a paragraph

When somebody asks for work in conversation, three things can happen, and two
of them are failures.

**The failure that looks polite** is a paragraph: *"Good idea — I'll file that
as a request."* Nothing exists. The person has to trust that something
happened and go looking for it later. They usually do not.

**The failure that looks efficient** is a silent write. The request appears on
the board and the person who asked never saw what was recorded, so the first
time they read it is when it is already being built from the wrong reading.

**What to do instead**: recommend the action, so the ask becomes a card in the
conversation with one button on it.

```
recommend_action(
  action_id: "objects.propose_candidate",
  action_input: { objectType: "request", title: <the ask, as an outcome>, … },
  label: "File this as a request",
  rationale: <what you understood, in one sentence they can correct>,
  suggested_decision: "approve",
)
```

The card is the answer. It says what will be recorded, the person approves it
in one tap, and the run it creates is on the record with who decided and when.
If they disagree they say so in the same conversation, and nothing was filed
in the wrong shape.

## Write the title as the outcome, not the instruction

The title is what the work is FOR, because it becomes the name of the work
item and the heading of its page. "Rename Send to Stamp at stampsend.com" is
an instruction. *"The product is called Stamp everywhere a customer sees it"*
is an outcome, and it is also the acceptance criterion.

## Say back what you understood

`rationale` is where a person catches you having heard the wrong thing, before
it costs a build. One sentence, in their language: what you think they want
and what you think done looks like. Not a plan — a plan is the planner's job
and comes after a person has agreed this is the work.

## When it is a question, not work

Some asks are answered, not built. Answer them. A card that files a question
as a request is the same failure as a paragraph that files nothing: it moves
the work to the wrong place. The test is whether anything would have to
change for the person to be satisfied.

## When the work already exists

Look it up first. If an open request already covers the ask, say so and link
it rather than filing a second one — a duplicate costs more than a slow
answer, because two people then build against two records.
