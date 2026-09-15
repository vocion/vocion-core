# The agent chat surface — one conversation, on every page

Every dashboard page carries exactly one conversation surface with the
workspace's agents. This document is the rule set that surface follows.
Until 2026-09-15 these rules lived only as doc-comments in
`features/dashboard/chat/*` (cited as `agent-chat-surface.md §n` after the
original spec, which was never committed); this file promotes them and adds
the rail (§9). The section numbers below match the citations in the code.

Read it beside the [Product Design Manifesto](./MANIFESTO.md): the surface
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
   default — recommended actions are cards the person taps into the review
   queue) or **Act within bounds** (recommendations are proposed into the
   review queue as they arrive and the card says so). Neither executes
   anything: the review queue and trust rules still gate every outward step.
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
   new event type (the canvas's `artifact`) folds it into the transcript
   without editing the hook.
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
    model — a tag is context, not only a router; `/search <query>` runs the
    retrieval-only path (listed in the composer's `?` shortcuts sheet; a
    "Search only" pill shows while it is armed). `conversation.agent_slug`
    keeps the lead. The rail's header is the workspace name too — scoped, the
    record it is about; the composer placeholder never names an agent. The empty
    state says "Ask <Workspace>" with the workspace's chips — the lead's
    suggestions plus one per team lead, capped at four — never an agent name.

## Where things live

| Concern | File |
|---|---|
| Route rules, mount point | `features/dashboard/chat/PageDock.tsx` |
| The rail | `features/dashboard/chat/ChatDock.tsx`, `railState.ts` |
| Resume rule | `features/dashboard/chat/resumeRule.ts` |
| Stream reducer, session state | `features/dashboard/chat/useChatSession.ts`, `traceReducer.ts` |
| Live / folded trace | `features/dashboard/chat/WorkTimeline.tsx` |
| Link chips | `features/dashboard/chat/links.ts`, `AgentMessage.tsx` |
| Feedback | `MessageFeedback.tsx`, `services/ConversationService.ts#setMessageFeedback`, adoption event `chat.feedback` |
| History + search | `HistoryPopover.tsx`, `services/ConversationService.ts#searchConversations` |
| Autonomy | `conversation.autonomy`, `AutonomyControl.tsx` + `autonomyOptions.ts` (the header chip), `RecommendedActionCard.tsx` (`autoPropose`) |
| Routing | `features/dashboard/chat/routing.ts` (default agent, `@` routing, `/search`, workspace chips), `services/agents/delegationRoster.ts` (roster, id-ordered; authored `subagents` win a slug collision in `harness.ts`), `rpc/agent/stream/route.ts` (server default = workspace lead; `context_refs` → `pageContext.ts`) |
| Entry function | `features/dashboard/chat/agentSurface.ts` |
| Schema | migration `0094_conversation_feedback_search.sql` (+ `concurrent/0094_conversation_search_idx.sql`) |
