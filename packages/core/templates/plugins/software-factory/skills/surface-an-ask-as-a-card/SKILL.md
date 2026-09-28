---
slug: surface-an-ask-as-a-card
name: Turning an ask in chat into something a person can start
description: >-
  What to do the moment a person asks for something new in conversation — a
  feature, a fix, a change, a rename. The answer is never a paragraph
  promising to file it and never a silent write: it is a card in the
  conversation the person can approve to start the work, or open to argue
  with. Read whenever a chat turn contains a request for work.
playbooks: [naming-the-work]
version: 5
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

**What to do instead**: CALL the `recommend_action` tool, so the ask becomes a
card in the conversation with one button on it. It is a tool call, not a
message. Never write the word `recommend_action`, a `CARD` label, or a code
block shaped like a call into your reply — text is not a card, and on
2026-09-24 three turns did exactly that (the person saw a block of YAML, no
button, and nothing filed). The arguments:

- `action_id`: `objects.propose_candidate`
- `action_input`: `objectType: request`, `title` (the ask as an outcome),
  `dedupOn: ["title"]` at the top level, and the fields you know — product,
  kind, severity, why, body in the asker's words
- `label`: "File this as a request"
- `rationale`: what you understood, in one sentence they can correct
- `suggested_decision`: `approve`

When the person then says "file it", "approve filing it" or "go ahead", that
is the same call again — the one you drafted, for the same ask, not a search
for an existing record that might be it. Reply in one sentence after the
call; the card carries the rest.

`dedupOn` is mandatory and it is the one that gets forgotten. It names the
fields that identify the thing, so the same ask made twice refreshes one
pending item instead of stacking a second copy. For a request out of a
conversation the identity is the outcome, so `["title"]`. It goes at the TOP
LEVEL of `action_input`, never inside `fields` — it is bookkeeping about the
record, not a value on it.

Leave it out and the tool refuses the call. That is not theoretical: on
2026-09-24 a request for a feature in chat produced no card at all, twice in
one turn, because both attempts omitted it — and this page's own example was
where that was learned from.

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
and what you think done looks like. Not a plan — a plan is the PM's job
and comes after a person has agreed this is the work.

## When it is a question, not work

Some asks are answered, not built. Answer them. A card that files a question
as a request is the same failure as a paragraph that files nothing: it moves
the work to the wrong place. The test is whether anything would have to
change for the person to be satisfied.

## When the work already exists

Look it up first. If an open request already covers the ask, do not file a
second one — a duplicate costs more than a slow answer, because two people
then build against two records.

**But this branch still ends in a card.** Saying *"that's already on the board
as request 124, in candidate state"* and stopping is the paragraph failure
again, one level down: the person asked for something, and what they got back
was a status report and no way to act on it. The ask is still live. What
changed is which action the card carries — not whether there is one.

So: link the record by id, say what state it is in, and recommend the move
that state is waiting for.

```
recommend_action(
  action_id: "objects.update_meta",
  action_input: { id: 124, status: "triaged", … },
  label: "Triage request 124 so it can be ranked",
  rationale: "You asked for this in chat; it was captured on 12 Sep and has
              been sitting in candidate ever since. Nothing has scoped it.",
  suggested_decision: "approve",
)
```

A record in `candidate` is waiting to be triaged. One already triaged is
waiting to be ranked or planned. One already planned has a plan to open. Every
state has a next move, and the person who just asked for the work is exactly
the person who can authorise it.

## Do not put questions where the card goes

A question is not a substitute for a card, and asking two of them before
offering anything is how an ask goes quiet. Most scoping questions are
answered better by a card the person can correct than by a paragraph they have
to reply to: the `rationale` says what you understood, and if you read it
wrong they tell you so in one line instead of answering an interview.

Ask at most one question, and only when a wrong answer would send the work
somewhere genuinely different. Put it alongside the card, never instead of it
— the person can approve, or answer, or both.

## The build decision is a second card, and it has a minimum

Filing the request is the first card. Asking a person to **commit** to building
it is the second, and it is the most important screen in the system, so it is
never a picture with a button under it. The picture supports the decision; it
cannot carry it (review, 2026-09-24).

Before this card exists, the commitment is written: the draft contract
(`write-task-contract`), `mainRisk`, `expectedResult` and `howWeCheck` on the
request, and the designer's mockup or a recorded `noVisualReason` for a `ui`
or `flow` change. Then file ONE ask of kind `recommendation` for the product
owner, whose body reads, in this order, in plain words:

```
**<the outcome, as the title>**
<who asked, how many, on which channel — one line>
**Recommendation:** <build it now / answer it / defer it> — <why, one sentence>
**Change:** <what will be different, one sentence>
**Done when:** <the acceptance criteria, as the person will check them>
**Expected spend:** $<low>–$<high> · **Your review:** about <n> minutes
**Main risk:** <one sentence>
**Expected result:** <what should change for people> · **We will check:** <how, and after how long>
```

as the card's words, and the card's ACTION is `factory.dispatch_task` with
`{ requestId, planId (when the work has one), reason }`. That is all it needs:
approving it builds the contract from the records — objective and acceptance
from the request, repo and paths from the plan, checks and risk from the repo
record — creates the engineering task, approves the plan, freezes the
acceptance and starts the engineer, in one tap. Add `contract: { allowedPaths,
riskClass, … }` only to override what the records would give. Do not write the
task first and do not say you wrote it (red team, 2026-09-26: "I've written the
contract" with no task behind it). Request changes is a reply in chat; Defer is the card's
own Defer. **Defer is not reject.** "Not now" is a normal product
decision; it carries a reason and a revisit date or condition, which you write
on the request (`state: deferred`, `deferReason`, `deferredUntil`).

**When the product owner tells you to build it, that is the decision.** Do not
answer "I can't sign this off myself": put the dispatch card up in the same
turn, so starting the build is one tap. **Never file an ask for work you can do
yourself** — reading runs, looking records up, checking the product. Do it in
this turn and report what you found.
