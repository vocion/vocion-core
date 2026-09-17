# The agent chat surface — one conversation, on every page

Every dashboard page carries exactly one conversation surface with the
workspace's agents. This document is the rule set that surface follows.
Until 2026-09-15 these rules lived only as doc-comments in
`features/dashboard/chat/*` (cited as `agent-chat-surface.md §n` after the
original spec, which was never committed); this file promotes them and adds
the rail (§9). The section numbers below match the citations in the code.

Read it beside the [Product Design Manifesto](./DESIGN-PRINCIPLES.md): the surface
exists so a person can act on what a page shows without leaving it (§11
*make the important things obvious*), with the machinery — tool calls,
reasoning, sources — one tap away but never in the way (§12 *hide complexity,
never hide truth*).

## §2 — Activity, not progress bars

- While the agent works the surface says what it is doing **now**, as a verb
  ("Searching sources…", "Handing off to Pipeline Analyst…"), never a
  percentage. Live rows appear as tool calls start and flip to done or error
  when they land; a delegate's specialist rows indent beneath it (§9).
- §2.1 rule 1 — level-1 lines expand independently; one control recollapses
  everything. Rule 4 — no progress bars. Rule 5 — a large paste becomes a chip
  beside the composer, never a flood in it.
- After the turn the trace folds to one line ("Worked it out · 5 steps · 3
  sources") that opens into the curated trace: reasoning, meaningful tool
  steps (plumbing hidden), delegations, citations.

## §3 — The dock is a core component

- The conversation is a **third column beside the page**, not a floating
  bubble: collapsible, defaulting to open on a record page and collapsed
  elsewhere. `ChatDock` is the component; `PageDock` mounts it once from the
  shell.
- §3.1 — a record-scoped conversation (`scopeRef`, e.g. `contacts:9412`)
  belongs to that record and to the person who opened it; it is never listed
  in the everything-scoped history and never shared between users (§8.6).
- §3.2 — below 1200px the surface covers the page as a sheet instead of
  narrowing it.
- §3.3 — a **briefing** is a record page like any other. One brief lives at
  `/dashboard/briefings/<id>` (`docs/specs/briefing-v2.md` §10), so the
  `briefing` record ref resolves to that URL and the rail's "About:" chip
  opens the brief it is scoped to rather than the list. `BriefingChatStarter`
  declares the record and watches `[data-briefing-root]` for a selection, so
  highlighting any passage of the rendered document pops "Ask Vocion" and
  opens the rail with that passage quoted — the typed renderer marks the same
  root the markdown one did. There is no second composer on the page.

## §6 — One entry function

Every entry point — the hotkey, the titlebar button, a page's "Ask about
this" — calls `requestAgentSurface()`. Whatever surface is mounted claims
the request by cancelling the event and focusing its composer; an unclaimed
request means no surface is mounted and the caller navigates to
`/dashboard/chat`. A page never carries two surfaces: routes that mount their
own scoped dock are listed in `OWN_DOCK_ROUTES`, and the shell's dock bails
there.

## §8.6 — Persistence

`conversation` and `conversation_message` are the system of record. The
`chat_widget_state` row is one pointer per (org, user) — since §9 a **recent**
pointer, not the current thread — plus the rail's geometry. Scoped threads
resume by `(orgId, scopeRef, createdBy)`.

## §9 — The rail (2026-09-15)

The dock became a rail: persistent, resizable, transparent about what the
agent is doing, and able to be talked back to.

1. **Form.** The rail is resizable by its left edge (drag, or arrow keys on
   the handle): never narrower than 320px, never wider than half the
   viewport, opening at a third of the screen. Width and open state persist
   in this browser (`localStorage`) and per user (`chat_widget_state.rail_*`),
   so a second device opens it the way the first left it. Collapsed, it is a
   slim tab on the right edge — not a bubble. **⌘J / Ctrl+J** toggles it;
   ⌘K belongs to the command palette.
2. **New chat by default.** A surface opens a **new** conversation unless the
   person is intentionally coming back to one: (a) this browser session was
   already in it (`sessionStorage`), (b) the URL names it
   (`?conversation=<id>`), or (c) they pick it from the history. The
   last-viewed pointer chooses the agent and seeds the history; it never
   chooses the thread. Landing on yesterday's thread was the bug this fixes.
   Record-scoped docks keep resuming their record's thread — a record's
   conversation is meant to be continuous.
3. **Live transparency.** The rows in §2 render *during* the turn, not after.
   Reasoning folds to one line — "Thinking…", then "Thought for 6s" — with
   its first sentence showing; expand for the rest. A tool that throws closes
   its row as an error with the message.
4. **In-app links.** A same-origin `/dashboard/...` link in an answer renders
   as a chip with an icon for its entity family (agent, mission, ask,
   briefing, object, review…) and navigates in place. External links open in
   a new tab. `classifyDashboardLink()` in `links.ts` is the shared
   classifier — a `link` card, when one exists, uses the same shape.
5. **Feedback.** Every assistant turn carries a thumb and an optional note,
   quiet until hovered (always visible on touch). The thumb is a metric
   (`chat.feedback` in the adoption stream); the note is what teaches — it is
   queued for the feedback classifier under source `chat` and can become a
   learning candidate (Manifesto §6: every correction is information).
6. **History and search.** The rail header has a history popover: recent
   threads grouped Today / Yesterday / Older, and a search over titles and
   message content (`conversations.search`, GIN-indexed in production via
   `migrations/concurrent/0094`). The command palette calls the same
   procedure. The header itself is ONE hairline-separated row, at most 48px:
   the workspace mark, the workspace (or record) name as the title, then four
   equal 32px ghost controls — history, the autonomy chip, the ⋯ menu, the
   collapse — each with a tooltip. The way out to the full-page chat is a row
   in the ⋯ menu; it was an underlined "All conversations" link under the
   title until 2026-09-15, where it read as an error and cost the header a
   second line. Every popover and tooltip on the surface passes Radix a
   `collisionPadding`, because the rail hugs the viewport's right edge and an
   un-padded panel renders past it.
7. **Autonomy.** Each conversation has a rung: **Ask before acting** (the
   default — recommended actions are cards the person taps into Needs you as
   proposals) or **Act within bounds** (recommendations are proposed as they
   arrive and the card says so, linking to the proposal's own screen at
   `/dashboard/inbox/proposal-:id`). Neither executes anything: the proposal
   kind on [Needs you](./guides/needs-you.md) and trust rules still gate
   every outward step.
   The choice persists on the conversation and carries into the next new one
   (Manifesto §8: automation is earned one rung at a time). The control is a
   quiet chip in the surface's header (`AutonomyControl`), stating the current
   rung and opening a popover with both options and their one-line
   consequences — **never in the composer**, which holds one input and one
   primary action. It was two segmented buttons inside the box until
   2026-09-15; a per-conversation setting does not belong in a per-message
   control, and it dominated the one it shared a border with. On a rail under
   400px the chip is its icon alone and the tooltip carries the words.
8. **Tags.** `@` in the composer tags an agent, team or mission the message is
   about — a chip beside the box, sent as `context_refs`
   (`{ type, id, label }[]`) with the turn, never inlined in the text. `?` on
   an empty box shows the shortcuts. The page-context model uses the same
   `ContextRef` shape for "the page I am on".
9. **Extension seam.** `useChatSession({ onEvent })` sees every SSE event
   before the built-in reducer and may claim it — how a surface that knows a
   new event type (the artifact pane's `artifact`) folds it into the
   transcript without editing the hook — that is how a turn that made or
   changed an artifact gets its chip (`ArtifactChips`) and how the pane beside
   the conversation opens on it. See [artifacts.md](./artifacts.md).
10. **One workspace agent — routing is delegation** (Chris, 2026-09-15:
    "let's get rid of this 'choose an agent'. We should always just be
    chatting with the Vocion agent, scoped/named to the current Workspace").
    There is exactly one conversational identity per workspace: the
    **workspace agent**, shown by the workspace's name ("Ask Revenue", avatar
    = the workspace initial), implemented as the workspace `lead` agent's
    config (first agent when no lead is set) plus the delegation roster
    derived at compile time (`services/agents/delegationRoster.ts`: the lead's
    registered children, then every team's lead *and* members; a team lead
    gets its own members). No agent picker exists anywhere in chat; `?agent=`
    is accepted for old links and ignored; the stream route's default agent
    is the workspace lead. Specialists appear only as attribution: a live
    "→ Proposal Writer · drafting the brief" row in the rail and a small
    "via Proposal Writer" eyebrow on a routed reply. Two power paths, both
    per turn and neither advertised in the header: `@agent` / `@team` in the
    composer routes that turn (a team tag → its lead; a Briefings hand-off
    routes its first turn the same way) and the tagged records ride along as
    `context_refs`, which the stream route validates (`services/chat/
    pageContext.ts#readContextRefs`) and notes under the message for the
    model — a tag is context, not only a router. The same popover also offers
    `@page` (the page in view and the record it is about) and `@artifact`
    (this turn owes a document — *Deliverables* below), and a `(+)` at the
    left of the box types any of them into the draft at the caret for people
    who would rather point than remember the word; `/search <query>` runs the
    retrieval-only path (listed in the composer's `?` shortcuts sheet; a
    "Search only" pill shows while it is armed). `conversation.agent_slug`
    keeps the lead. The rail's header is the workspace name too — scoped, the
    record it is about; the composer placeholder never names an agent. The empty
    state says "Ask <Workspace>" with the workspace's chips — the lead's
    suggestions plus one per team lead, capped at four — never an agent name.

## §12 — The composer never locks (2026-09-15)

The box used to go `disabled` for the whole turn. That is the wrong default:
the moment you most want to add "and skip the ones already closed" is halfway
through the tool calls, and a locked box teaches people to stop thinking while
the agent thinks.

**The contract.** The textarea and the primary action stay live for the entire
turn, with no visual disabled state at any point. Enter always does something
useful:

| Gesture | While idle | While a turn is streaming |
|---|---|---|
| `Enter` | sends | **queues** — never interrupts |
| `⌘⏎` / `Ctrl+⏎` | sends | stops the turn and sends immediately |
| `Esc` (empty box) | — | stops the turn |
| `Esc` (with text) | — | nothing — a stray Esc must not eat a half-typed thought |

**Queued rows.** Queued messages render as compact rows directly above the
composer, oldest first: the text, an ✕ to drop it, and a click on the row to
pull it back into the box for an edit. At most three are visible with a
"+N more" (a phone keeps its viewport). The placeholder changes to
"Queue a message… ⌘⏎ to send now" so the affordance is discoverable.

**The flush.** When the turn LANDS the queue drains itself, one message per
completed turn, in order, as separate user turns — nobody has to touch
anything. When the turn is **stopped or fails**, the queue is kept and the
composer says so ("The turn ended early — these were not sent."). A person's
typing is never dropped quietly, and never sent without them noticing either.

**Persistence** is `sessionStorage`, keyed per conversation, so the queue
survives a rail resize, a collapse/expand and a route change inside the
workspace. A `new` thread that acquires its id carries its queue across;
switching to another thread adopts that thread's queue. A full page reload in
a new tab starts empty, by design.

### Why there is no mid-turn steering (yet)

A queued message does **not** reach the turn that is already running. The
investigation and the exact blocker, so nobody has to redo it:

1. **There is a natural checkpoint.** LangChain v1 middleware exposes
   `beforeModel` / `wrapModelCall`, which run between the tools node and the
   next model call. `createDeepAgent` takes `middleware`, so a hook could drain
   a per-run mailbox there. No checkpointer, no LangGraph state surgery, no
   protocol change. That part is a day's work.
2. **The blocker is the provider's message shape.** At that checkpoint the
   messages are `[…, AIMessage(tool_calls), ToolMessage]`. Appending the
   interjection as a `HumanMessage` puts two consecutive `user` turns on the
   wire, and `@langchain/anthropic`'s `mergeMessages`
   (`utils/message_inputs.js`) merges only consecutive *tool_result* user
   turns — so it is sent as-is and Anthropic rejects it for alternating roles.
   The only way to land the words in context without a redesign is to append
   them to the last tool result, which makes the audit trail say a tool
   returned something a person typed.
3. **It would only ever work on one harness target.** `in-process` is the only
   one where we own the loop. `agentcore-container`, `aws-managed-harness` and
   `external-worker` run the loop in another process behind a one-shot
   `POST /invocations` (or a queued `worker_run`) with no inbound channel
   mid-turn — steering there is a protocol change on both sides.

**The smallest unlock** is (2): a `steeringMiddleware` whose `wrapModelCall`
rewrites `request.messages` so the interjection rides as an extra text block on
the tool-result user turn, plus a decision on whether the persisted tool output
carries it. Add a mailbox keyed by the `streamId` the route already mints (see
`libs/streams/buffer.ts`, same in-process scope, same single-container
assumption) and a `POST /rpc/agent/steer` to post into it. Until that decision
is made, the transcript would have to pretend a tool said it — so it is not
built, and the queue is the honest behaviour.

## Deliverables — "this turn produces an artifact" is a contract (2026-09-16)

Somebody typed *draft a pipeline report* and expected a document to open in the
pane. What they got was a "Tool error" badge, one "Delegating to …" line, a
paragraph of narration, and nothing beside the conversation. Their question was
the right one: **how do we make that opt-in deterministic?**

Whether a turn ended in an artifact used to be a judgement the main model made
while it was also doing the work, steered by prompt wording. That is exactly
the failure mode `CLAUDE.md`'s *Structural over prompting* bullet describes, so
the answer is the same one: a typed contract, deterministic post-processing,
and a gated backstop — in that order.

### The contract

`deliverable` is a field on the turn request (`/rpc/agent/stream`), carried
into `runAgentDeep` and into the `agentcore-container` payload
(`packages/agent-runtime` `InvocationRequest`), so it reaches all three
harnesses that run a loop:

| Value | What it means |
|---|---|
| `artifact` | This turn MUST end with an artifact beside the conversation. |
| `answer` | The reply is the whole deliverable. |
| absent | Same as `answer`. |

The definition is `libs/chat/deliverable.ts` — pure, no React, no database, so
the composer, the route and the harness read one file. `readDeliverable` is the
wire parser: anything that is not one of the two values is `undefined`, so a
typo can never arm the backstop by accident.

### Arming it: `@artifact`, and the `(+)` beside the box

The person types `@artifact`. That is the whole opt-in.

It rides the composer's **existing** `@`-mention (§9): `@artifact` appears in
the same popover as `@page`, `@team` and the record in view, resolves into the
same chip, and is read by the same reader — so arming the contract is the same
gesture as pointing a turn at a team, not a second mechanism beside it
(Manifesto §19). Like every other ref, the tag never travels as text: the chip
carries it, and it is stripped out of `context_refs` before the wire, because
it points at no record — it states what the turn owes
(`libs/chat/deliverable.ts#deliverableFromRefs`).

A **`(+)`** at the left of the box is the pointer path to the same list. It
opens *Add to this turn* — `@artifact`, `@page`, and the record the page is
about — and choosing one **types the tag into the draft at the caret**. Nothing
else: no store, no event, no flag of its own. The `@` reader then offers the
chip exactly as if the word had been typed. The list is built once per surface
(`composerTags.ts`, pure; `tagSearch.ts` adds the fetched half) so the keyboard
path and the pointer path can never drift.

It knows nothing about sending. The composer's send handler, key handling and
queue behaviour (§12) are untouched — Enter still queues mid-turn, ⌘⏎ still
interrupts, the box never locks. The tag is per MESSAGE: it clears with the
rest of the refs when the turn goes out.

**Why not a chip that arms itself.** The first cut was an icon chip beside send
that a pure classifier pre-armed from what was being typed. Chris killed it
(2026-09-16): *"not sure I love this. Maybe start it as something that we can
tag in the chat. or in a (+) button menu that let's me pull in tools explicitly
(by injecting the tag into the text)."* He is right, and the reason generalises:
**explicit and discoverable beats inferred.** An opt-in that arms itself is one
you have to notice and undo, and a person who never looks at the chip cannot
learn it exists; a word you type is a thing you meant, and a menu that types it
for you is how you find out the word. The classifier is gone, not disabled.

### The backstop

`services/agents/deliverableBackstop.ts`, applied by `applyTurnGuarantees` in
`AgentService` for every harness target. It fires only when the turn was sent
with `deliverable: 'artifact'` **and** called no `render_*` /
`create_artifact` / `update_artifact`:

- **Long-form answer** (headings, a markdown table, or ≥120 words) → wrapped
  verbatim into a markdown artifact, author `system`. No model, nothing
  invented: the pane shows exactly what the agent wrote.
- **Short answer** (the narration case) → ONE gated model pass over the turn's
  transcript and tool results, in the pattern of
  `harnessConfig.recommendActionBackstop`. It returns the document, or an
  explicit stub — *"Pipeline report — not completed"*, with what failed and
  what is needed. A model that is unavailable, or that answers with something
  unusable, falls through to the same stub built deterministically.

**A stub is a legitimate artifact; a silent nothing is not.** Either way the
answer gains one sentence saying an artifact was created and why — an artifact
that appears unannounced reads as the agent having decided to make one, which
is the ambiguity this whole mechanism removes.

See [artifacts.md](./artifacts.md#guaranteeing-an-artifact-when-one-was-asked-for).

### Intents — `@change`, beside `@artifact` (2026-09-16)

`@artifact` says what the turn **owes**. `@change` says what it must **do**.

On the personalization lead page one ask is not a question: *this must alter
the sequence draft*. That used to be decided by a wording heuristic
(`isRevisionAsk` — "shorten", "rewrite", "make…"), which is the same
prompt-shaped guess `deliverable` exists to replace, one level down. It is a
tag now:

| Tag | `type` | `id` | What it changes |
|---|---|---|---|
| `@artifact` | `deliverable` | `artifact` | the turn must end in a document |
| `@change` | `intent` | `change` | the ask routes to `rewriteDraft`, not to an answer |

Same mechanism as `@artifact`, deliberately: it is offered by the same `@`
popover, inserted by the same `(+)` menu, resolved by the same reader into the
same chip, and **stripped from `context_refs` before the wire** because it
points at no record (`composerTags.ts#isIntentTag`,
`useChatSession#sendMessage`). The definition lives in
`features/dashboard/chat/composerTags.ts` next to the artifact tag's.

**How it gets armed.** Usually not by typing. Selecting a passage in the brief
raises the standard selection control, whose second action — *Add change* —
stores the anchored note AND arms the tag (`AgentSurfaceRequest.tags`, applied
by the rail through `addContextRef`). So the person sees one pattern
everywhere — select → talk — and the tag is what makes a particular ask act.
`(+)` offers `@change` **only where a sequence draft is in view**; an intent
that cannot be carried out is not listed.

**What reading it does.** `ChatDock`'s send path calls
`guided.askAbout(text, { contentId })` where `contentId` comes from
`guidedFlow#contentIdForAsk` — the anchor's own content id when the selection
was inside a send, else the send the text names ("send 2"), else the send under
review. That goes to `ReviewService.rewriteDraft({ runId, hint, contentId })`,
exactly as before. An ask carrying the tag is ALWAYS a revision: the person
said so, and a wording heuristic has no business overruling them. Without the
tag the heuristic still decides, so what reviewers already type keeps working.

See [design/patterns.md](./design/patterns.md) → *Select → talk*.

## Failures reach the person (2026-09-16)

The same turn also proved that a **failed delegation was invisible**. The
specialist's `task` call threw; the trace emitter had no case for either shape
a tool failure arrives in, so the persisted `trace_json` held exactly one node
— `{ kind: 'delegate', status: 'start' }` — with no terminal node of any kind.
From the transcript, a specialist that died was indistinguishable from one
still working.

Three fixes, all structural:

1. **Both failure shapes are read.** LangGraph's `ToolNode` catches a throwing
   tool and returns a ToolMessage with `status: 'error'` (an ordinary
   `on_tool_end`); when nothing catches it, LangChain emits `on_tool_error` and
   no end event at all. `traceEmitter.ts` handles both, and a run that dies
   mid-delegation closes every open delegation as an error
   (`closeDelegations`).
2. **The answer says so.** `delegationFailureNotice` appends one sentence when
   a hand-off failed and the answer did not own up to it — prompting the model
   to mention it is not the mechanism, it is the optimisation.
3. **The persisted turn carries it.** `RunCollector` (now
   `services/chat/runCollector.ts`, so it can be tested) folds `tool_error`
   into `runs_json` as a failed step, and `ConversationRun.state` is persisted
   so a reload still tells a step that failed from one that worked.

## The page's artifacts are canonical (2026-09-16)

`PageContext` gained two fields, and one of them closes a trust hole rather
than adding a convenience:

- **`artifacts`** — the artifacts the page is SHOWING, as `RecordRef`s of type
  `artifact`. Not `record` (what the page is *about*) and not `refs` (what the
  person *tagged*): neither said what was on screen, which is how the rail came
  to answer *"there's no brief or proposal to review here"* beside a page
  rendering a brief, and to assert engagement facts on a brief that marked
  those fields **unavailable** (`docs/specs/personalization-v2.md`).
- **`state`** — the user-visible state as short label/value pairs: which tab is
  open, whether a decision is waiting, what the sequence state resolved to.

`services/chat/grounding.ts` resolves the ids **server-side, under the caller's
org**, flattens each artifact to text (a typed sequence keeps its numbered
sends, so "make Send 2 less salesy" has a referent), and appends one block to
the turn after the where-I-am note. The client names what it is showing; the
server decides what that says. Nothing a client sends becomes a fact.

The block declares the artifacts canonical and names four epistemic classes the
answer has to keep apart — **CRM fact, research finding, inference, and
unavailable** — with the last spelled out, because it is the one that was being
silently converted into a finding: *unavailable is not zero and not a finding;
if the brief says engagement data was unavailable, you may not say the contact
has not engaged.* Written in code, like `describeThread`'s gap sentence, for the
same reason: a model told to "use the page context" writes "there's no brief
here"; a model handed the brief does not.

This is **grounding, not rendering.** What the rail may DRAW is unchanged — the
rule that it never re-renders what the page shows (`docs/design/patterns.md`)
and its predicate `pageShowsRecord` are untouched. The person sees only the
*Working with:* chips naming what the turn carries.

## Slack → feedback → ask → work (2026-09-15)

The surface is not only the dock. An agent answering in a Slack thread is on
the same surface with a different frame, and the same rules apply: it must know
where it is (§3.1's `scopeRef` becomes the channel and thread), and it must
never hide the truth about what it could not see (§12). A thread's context is
built before the turn and handed over as the same `PageContext` a dashboard
page fills — channel, the message being replied to, the posters, the workspace
answering, and an explicit list of the Slack scopes the install lacks with what
each would have bought. When something is missing, the sentence the channel
hears names the scope (``groups:history`` would let me read the message this
thread started with) rather than saying there is no context.

The loop that closes it is the manifesto's learning rule made structural. A
mention that reads as feedback — decided by a cheap pure classifier, with the
model asked only when that is unsure — is filed by the `file_feedback` tool as
two things: a `learning_candidate` carrying the person's own words and a
permalink back to where they said them, and, where the workspace has a team
that builds, an ask of kind `recommendation` in its Needs-you inbox with *Plan
and start* / *Add to backlog* / *Decline*. The agent's reply says what it filed
and links the inbox item. **Approving the recommendation is what starts the
work** — nothing executes from a chat client, which is decision 025 unchanged.
So a person who says "you should have…" in a thread has, by the time they put
their phone down, a decision waiting for them rather than a message somebody
might read.

## Where things live

| Concern | File |
|---|---|
| Route rules, mount point | `features/dashboard/chat/PageDock.tsx` |
| The rail | `features/dashboard/chat/ChatDock.tsx`, `railState.ts` |
| Resume rule | `features/dashboard/chat/resumeRule.ts` |
| Stream reducer, session state | `features/dashboard/chat/useChatSession.ts`, `traceReducer.ts` |
| Composer, queue + interrupt (§12) | `features/dashboard/chat/ChatComposer.tsx`, `queueReducer.ts`, `useSendQueue.ts`, `composerQueue.ts` |
| Live / folded trace | `features/dashboard/chat/WorkTimeline.tsx` |
| Link chips | `features/dashboard/chat/links.ts`, `AgentMessage.tsx` |
| Feedback | `MessageFeedback.tsx`, `services/ConversationService.ts#setMessageFeedback`, adoption event `chat.feedback` |
| History + search | `HistoryPopover.tsx`, `services/ConversationService.ts#searchConversations` |
| Autonomy | `conversation.autonomy`, `AutonomyControl.tsx` + `autonomyOptions.ts` (the header chip), `RecommendedActionCard.tsx` (`autoPropose`) |
| Deliverable contract | `libs/chat/deliverable.ts` (the type + the parse), `features/dashboard/chat/composerTags.ts` + `tagSearch.ts` (`@artifact` and the `(+)` list), `ChatComposer.tsx` (the `(+)`), `services/agents/deliverableBackstop.ts` + `AgentService#applyTurnGuarantees` (the guarantee) |
| Persisted turn | `services/chat/runCollector.ts` — what a reloaded transcript says, including failed steps |
| Recommendation boundary | `features/dashboard/chat/recommendedAction.ts` — a payload that cannot produce a valid `review.propose` never becomes a card |
| Routing | `features/dashboard/chat/routing.ts` (default agent, `@` routing, `/search`, workspace chips), `services/agents/delegationRoster.ts` (roster, id-ordered; authored `subagents` win a slug collision in `harness.ts`), `rpc/agent/stream/route.ts` (server default = workspace lead; `context_refs` → `pageContext.ts`) |
| Entry function | `features/dashboard/chat/agentSurface.ts` |
| Schema | migration `0094_conversation_feedback_search.sql` (+ `concurrent/0094_conversation_search_idx.sql`) |
