# Decisions

Everything Vocion asks a person to decide is one thing: a **Decision**. One
question, a few named answers with what each one does, room to answer in your
own words, and Skip — docked just above the composer, answered from the
keyboard, and handed back to the agent that asked as a typed record of what you
chose. Never as words you did not type.

This guide is the model: what a Decision is, when an agent raises one, how it is
answered, and where it lives. The card's drawing and keyboard contract are in
[`docs/design/patterns.md` § Decision card](../design/patterns.md#decision-card).

## Why one

Before this, a person was asked to decide through ten unrelated mechanisms — an
ask on Needs you, a recommendation card, a proposal card, an approval gate held
only in the browser, a ruling's typed options, chips that sent text, a connect
card, a Build it button, a "Draft needed" button — and **every answer re-entered
the chat as a new user message**. The router read "the second one" for who should
answer it; the intent judge read it for what was wanted and sometimes made the
turn read-only; a click on a card was written to the transcript as "Approved the
card …", words nobody typed. Five conflicts followed from that one fact:

1. An answer could land on a different agent from the one that asked, as a question.
2. An ask filed in the person's own turn was refused with "ask them here, in one
   line" — so the question arrived as prose and the answer as prose, bound to nothing.
3. The approval gate (`request_human_review`) told the model to wait, and the
   model talked on past it.
4. A typed A/B/C/D choice was recorded as "approve" — not which option.
5. Every done-for-you run promised "a person can undo it", including kinds with
   no undo; and `decide_proposal` pointed the model at a `list_proposals` tool
   that does not exist.

## What a Decision is

A Decision is the **ask** (`ask` table, `services/AskService.ts`) read as one
shape (`libs/decisions/decision.ts`). No parallel table: the ask already held the
question, the options and the answer; migration `0193_decision` added what a
docked, typed Decision needs.

| Field | Where it lives | What it is |
|---|---|---|
| question | `ask.title` | One line, as a person would ask it aloud |
| why | `ask.body` | Two to four lines |
| options | `ask.options[]` | `{ id, label, description, recommended, action }` — `description` is the one-line consequence; `action` is the **effect**: the exact typed action it runs, as the person who chose it |
| something else | `ask.allow_other` | Whether a free-text answer is offered (default yes) |
| several | `ask.multi_select` | Whether several options may be chosen together |
| owner | `ask.owner_user_id` | The accountable person it waits on |
| asker | `ask.agent_slug` | The agent that raised it — the one the answer goes back to |
| conversation | `ask.conversation_id` | Where it docks; null for one that lives only on Needs you |
| deadline, default | `decision_deadline` | The decision clock (`DecisionClockService`) |
| answer | `ask.decision`, `chosen_option_ids`, `decision_note`, `decided_via` | Which options, their words, where it was answered |
| effect run | `ask.effect_run_id` | The action run the chosen option started — what Undo reverses |

**Kinds** map onto the ask's own vocabulary rather than adding one: `input` and
`credential` are a *question*; `ruling` and `recommendation` a *choice*;
`approval`, `merge` and `gate` an *approval* (Approve / Reject when no options
are named). *Sign-off* and *setup step* arrive with artifacts and objectives.
An approval of a **proposal** needs no row of its own: it is the pending
`action_run`, read as a Decision — a second row wrapping it would put every
proposal on Needs you twice and in front of every reader of open asks.

**States** are read off the row: `open` → `answered` · `skipped` · `defaulted`
(the clock applied the default) · `expired` (the deadline passed with no default
that could apply) · `withdrawn` (the asker took it back) → `undone`, only where
the effect's kind has an undo.

## When an agent raises one

The escalation rule, in one place (`services/decisions/escalate.ts`, called
from the chat route for every producer event that used to draw a card —
`recommend_action`, the card backstop, `propose_action`, "Draft needed",
`offer_connection`, `propose_setup`, `request_human_review`):

- **Inside the trust bar and reversible** → just do it, and say so in one line
  under the turn: a **Done receipt**, with Undo *only* where the action's kind
  defines one (`libs/actions/undoable.ts`). An email that went out says Done and
  nothing else.
- **An unclear instruction** → one *question* Decision.
- **Several viable paths** → a *choice* Decision, with the recommendation first.
- **Outside the trust bar** → an *approval* Decision, asked as a permission
  prompt (below). A proposal waiting on approval **is** its own approval: the
  pending `action_run`, read as a Decision, answered through Review's own
  `decide` path — never a second row.
- **A step of setting up** → a *setup* Decision: "Add Software Factory" runs its
  one action as the person, with Undo; "Connect GitHub" has options that **open**
  the sign-in or the token form (in-app links), and the step is answered, typed,
  when the person lands back in the conversation (`useAnswerOnConnectReturn`). A
  refused login keeps the step docked and says why on it.
- **Connect your systems** (`connect_system`) → one *setup* Decision whose
  option opens the docked walk-through; while the walk runs it **is** the docked
  card, each step drawn by the same Decision card, and Done answers the Decision
  with what happened (`services/connect/settleWalk.ts`).
- **A step whose effect has a picture** ("Make it yours", `propose_brand`) → a
  *setup* Decision whose option carries its **look** — the card kind declares it
  (`CardKindDescriptor.look`), the option keeps it (`AskOption.look`), and the
  card draws the drafted brand on the app's own chrome above the options
  (`chat/decisions/looks.tsx`). "Adjust" opens its settings with the draft.
- **A deliverable to sign off** → a *signoff* Decision: Sign off, Discard, or
  "Revise — say what to change…" in their own words.
- **Nobody is here** (a mission, an automation) → the Decision goes to Needs you
  with its deadline and default.

In a person's own conversation an agent raises a Decision with `file_ask`; it is
asked **there**, docked above the composer, owned by that person. Raising a
Decision **ends the turn** (`agents/handOff.ts`): the next move is theirs. The
approval gate ends the turn the same way. A turn that ended at a Decision is
complete, never "stopped without answering".

A credential is never asked in chat — its value must not travel through the
conversation — and a person who says "put it on the queue" gets it on Needs you.
A Slack or email thread reads only words, so there the agent asks in one
numbered line until those channels draw the Decision as a numbered message
(step 4 below).

### An approval is a permission prompt

Modelled on Claude Code's: one card, the same component, no second approval UI.

```text
REVENUE LEAD ASKS
Allow Revenue lead to move Northwind to Negotiation?
They signed the LOI on Tuesday.
┌──────────────────────────────┐
│ deal #4410                   │   ← the exact payload: the email as it will go
│ dealstage → negotiation      │     out, the fields a record update sets, the
└──────────────────────────────┘     command (`services/decisions/preview.ts`)
 1  Allow once      Recommended  Runs it as you, this once — with Undo.
 2  Always allow "update a HubSpot record" in Northwind Support
                                 Runs it now, and moves this kind to Execute within bounds.
 3  Deny                         Nothing runs; the agent revises from your no.
 4  Something else…
```

- **Allow once** is recommended and preselected; `⌘↵` takes it whatever is
  highlighted. **Deny** is `Esc`.
- **Always allow** is the trust ladder's own promotion
  (`autonomy/AutonomyService.promote`), offered only where the ladder would take
  it **for this person**: they are an admin, the next rung is earned on the
  alignment evidence, and that rung automates (`services/decisions/alwaysAllow.ts`).
  Anywhere else it is not on the card; sent anyway, it is refused and nothing
  moves. Choosing it promotes the kind, then runs this one as Allow once; the
  agent hears "Always allow".
- **Something else…** is their words back to the agent (on a proposal, a
  rejection with their note, which the proposer revises from).

### A Done line says what its run is now

A receipt is stored with its turn, but Undo happens later — on the line, on
Review, in another tab. A transcript read back stamps each receipt with its run's
status (`services/decisions/liveReceipts.ts`): an undone run reads **Undone**,
with no second Undo. A run the person told the agent to do in so many words
(read by the consent judge) runs at once and its line is named as they saw it.

## How it is answered — answers first

While a Decision is open in a conversation, the next thing that happens there is
judged **against it, before it is routed or intent-read**
(`services/decisions/answersFirst.ts`):

- **The card** sends a typed answer — `decision_answer: { id, option_ids |
  free_text | skip }` — on the turn it starts. It is recorded as it is; nothing is
  read, nothing is routed. The transcript shows a receipt on the person's side
  ("Chose Northwind API · Which repo…"), stored as a `decision` row, never a user
  message.
- **The composer** sends their words. A small model reads them against the one
  open Decision and returns a typed field, `answers_open_decision: { kind:
  option | free_text | none, option_ids, free_text }`
  (`turnJudge.readDecisionAnswer`); code routes on it
  (`decisionAnswerFromReading`). "2", "the second one", "go with the API repo" are
  options. "1 and 3" on a Decision that takes one is their words, sent to the
  asker as a free-text answer. A genuinely new topic routes as it always did, and
  the agent that answers it is told the Decision is still waiting, so it is never
  asked twice.

- **While the agent is still replying** to the last answer, the next card is
  live: an answer given then is **held** and goes the moment that turn lands —
  never dropped, never blocked.

Either way the answer goes to **the agent that asked**, as a typed decision event
it binds by id:

```text
[decision #41 answered] Which repo should the factory build in?
Chosen: Northwind API (option api) — its action ran as theirs
This is their answer to the question you asked. Act on it now; do not ask it again.
```

An option with an effect runs it **as the person who chose it**, through the
action rail (the trust ladder, the action's own precheck and its Undo all apply),
before the agent hears the answer — so the agent is never told "do it now" about
something already done. A second answer is a conflict, never an overwrite.

A card decided on a proposal records its decision **on the card** — the action,
who, when, and which typed option — and the next turn replays the card as what its
proposal is now. No turn is written in the person's name.

## Where it lives

- **Chat** — docked above the composer on every surface that has one (the chat
  page, the rail, a conversation's artifact view), one at a time, "1 of 3" when
  more wait, folded to one line with Esc. Opening a thread docks what it waits on.
  **An empty chat opens warm** (#1264, `chat/emptyChat.ts`): no docked card
  unless the person started that flow, and what waits on them elsewhere — a Needs
  you question with no conversation, a proposal filed from none
  (`DecisionService.waitingElsewhere`) — is the one soft, dismissible chip,
  "3 things waiting on you →", to Review (`WaitingNudge`). **What waits
  elsewhere never docks by itself** (`dockPlan`, 2026-10-09: a tracker review
  docked 400ms after "setup my software factory" and came back between setup
  steps, beside the lead's own question — "two prompts in different areas").
  In a conversation under way it is the same chip, shown only while nothing of
  the conversation's own is docked and no turn runs; tapping it docks the queue
  there under "Waiting on you", answered where it lives with no turn; the dock
  says once what the answer did.
  On a phone everything pinned above the composer is capped at a quarter of the
  screen (and a short screen — a phone on its side — at 45%) and scrolls inside
  (`PINNED_MAX_CLASS`); a docked card keeps its question and its Submit pinned
  while its middle scrolls, its why is one line, every control is 44px, and a
  new card opens on its question. "Connect your systems" keeps its place across
  a reload or a trip through the drawer while its Decision is open
  (`connect-systems/walkMemory.ts`), and walks only what the person scoped — the
  systems they named, or the app's — never what evidence adds to it.
- **The past turn** — a Decision a call raised and a Done line it produced are
  replayed with that call's result on the next turn (`chat/historyTools.ts`), so
  the agent binds the answer to the call that asked and never asks twice.
- **Needs you** — every Decision is an ask, so it is listed there today with its
  deadline and default. The card's `list` variant is the row it moves to.
- **Slack and email** — the same Decision as a numbered message, answered by
  replying with a number or in words (the numbered-reply rendering is the last
  step of the rollout below).

## Context mid-objective (step 3)

Founder, 2026-10-09, on a phone, mid "setup my software factory": *"Does it
give or should I have context mid objective?"* It did not. A walk said "3 of
5", its summary "Connected 0 of 5" and the dock "1 of 4", and none of them said
what the whole thing was, what was done, what came next, or how to stop and
come back.

**One quiet line, pinned above the dock while an objective runs.**

```text
● Setting up Software factory · 2 of 3                       Stop
┌ PRODUCT MANAGER ASKS ───────────────────────────────────────┐
│ Which repositories should the factory include?              │
└─────────────────────────────────────────────────────────────┘
[ Or reply directly…                                           ]
```

- **One line, never a card.** The Decision below stays the one thing asking.
  The line sits in the composer's `pinned` slot, outside the phone's capped,
  scrolling dock slot, so it never scrolls away. Its controls are 44px on a
  phone.
- **Tapping it lists the steps.** Each step shows as done ✓, the one you are on,
  or next.
- **Stop pauses it** ("Paused setting up … · Resume"). Nothing else changes:
  done steps stay done and an open Decision stays open. Resume undoes Stop.
- **When the last step is done** it says "<name> is set up" once, and can be
  put away.
- **It survives a reload, the drawer, another tab and another device.** The
  conversation keeps only *which* objective and whether it was stopped
  (`conversation.objective`, migration 0201). The steps and what is done are
  read live from what the plugin declares (`setupStateForOrg`), so a step
  done anywhere is done here.
- **It starts when a turn reads the setup.** In a person's own conversation,
  `describe_setup` starts the objective (the agent may name the plugin). With
  two plugins unfinished and none named, nothing starts, so the line never
  names the wrong one.
- **The next visit offers to resume it.** The opening-hint ranker's setup
  candidate (`libs/chat/openingHints.ts`) becomes "Resume setting up
  <name> →", scored above a plain setup hint. It opens the conversation where
  the objective stands (`?conversation=<id>`). The same dismissal hides it.

Code: `libs/objectives/objective.ts` (pure), `services/objectives/ObjectiveService.ts`,
`routers/Objectives.ts` (`objectives.current | stop | resume`),
`chat/objectives/ObjectiveStrip.tsx`.

## Rollout

One concept, landed in four steps, each its own pull request:

1. **The Decision** — the record (`0193`), the typed events, the docked keyboard
   card, answers first, the turn ending at a Decision, typed card decisions, and
   the Done receipt with honest Undo. In-turn `file_ask` is the first producer.
2. **One shape** — the remaining mechanisms (the approval gate, ruling and
   recommendation cards, proposals, Draft needed, the connect card, Build it,
   artifact sign-off) become Decisions; "Waiting on you" becomes the queue
   indicator; deadlines show on cards.
3. **Objectives** — a setup or onboarding flow is a parent objective of ordered
   Decisions and steps, with progress and Stop.
4. **Every channel** — Slack and email numbered replies, and Needs you drawn with
   the same card.

## For integrators

- `GET` what a conversation waits on: `decisions.open({ conversationId })` (oRPC).
- Answer one on a chat turn: `POST /rpc/agent/stream` with `conversation_id` and
  `decision_answer`.
- Every answer still emits `ask.decided`, so an automation that listened for asks
  hears Decisions without changing.
