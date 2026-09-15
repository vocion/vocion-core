# Acting from context — the record travels with the question

Reading a brief, an ask, or a team's row and then *doing something about it*
should be one motion, not a copy-paste into a chat. This guide covers the four
pieces that make that true (release "Rail + Canvas + Airy", slice R4) and how a
page opts in. Design bar: [Product Design Manifesto](../MANIFESTO.md) §10–§11 —
humans manage outcomes, and the interface surfaces decisions and next actions.

## 1. Structured page context

Every turn from a dashboard surface carries `page_context`:

```ts
type RecordRef = { type: RecordType; id: string; label?: string; href?: string };
type PageContext = {
  path: string; // route the person is on
  title: string; // document title
  record?: RecordRef; // what the page is about
  selection?: { text: string; quote?: true }; // highlighted passage
  refs?: RecordRef[]; // @-mentions from the composer
  openedFrom?: true; // opened via an "Ask about this" affordance
};
type RecordType = 'briefing' | 'ask' | 'agent' | 'team' | 'mission' | 'mission_run'
  | 'object' | 'deal' | 'worker_run' | 'conversation' | 'canvas-tile';
```

Source of truth: `services/chat/pageContext.ts` (`readPageContext` validates the
wire shape; `withPageContext` renders the compact "where I am" note the model
reads under the message; `mergeScopeRef` folds a scoped dock's `scope_ref` in as
a ref instead of excluding it). The model can also pull the same object as JSON
with the `page_context` tool (`services/agents/tools/pageContext.ts`).

The FIRST turn's context is persisted on `conversation.context_json`
(migration `0096_conversation_context`), so history reads "opened from Revenue
Briefing — Mon, Sep 15" rather than a bare title.

### Declaring a page's record

Server component:

```tsx
import { RecordContext } from '@/features/dashboard/context/RecordContext';
import { recordRef } from '@/services/chat/recordContext';

<RecordContext record={recordRef('mission_run', run.id, run.title)} />;
```

Client component: `useRecordContext(recordRef(...))`. `PageDock` reads the
declared record and sends it as `page_context.record` with every turn. The
provider (`PageContextProvider`) is mounted once by `AppShell`.

## 2. Opening the surface with intent

```ts
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';

openAgentSurface({ prompt: 'Do this: nudge StreetTalk before Sep 19', send: true, context, agentSlug }, href => router.push(href));
```

A mounted surface claims the request synchronously (the event is cancelable)
and reads the intent with `agentSurfaceRequestOf(event)`; with nothing mounted
the caller lands on `/dashboard/chat` with a stashed handoff
(`CHAT_HANDOFF_KEY`) — the pre-R4 path, unchanged.

`<AskAboutThis record={…} />` is the generic affordance: a small button (or an
icon), plus — with `selectionRoot` — the floating "Ask Vocion" pill over text
the person highlights inside that root. Placed today on the Briefings page
(every `##` section, and "Do this" on each bullet of an action section — see
`BriefingSections.tsx`), agent, mission, mission-run and object pages.

**One surface per page (058 §6).** Affordances only ever *prefill* the mounted
surface (`send: false`); they never render a second input. The Briefings page
therefore has no composer of its own any more — `BriefingChatStarter` is now
just the record declaration plus the selection watcher. Briefing routes count
as record routes in `PageDock`, so the rail opens by default beside the brief.

**Context chip.** When the dock opens on a page that declared a record, the
composer shows a dismissible chip — *About: Revenue Briefing — Mon, Sep 15* —
and, after a selection ask, the quoted passage. Dismissing the chip asks
without the record for the rest of that dock session; a fresh affordance click
brings it back. The dock reads intent with `agentSurfaceRequestOf(event)` in
its `AGENT_SURFACE_EVENT` listener (prefill → attach → focus; `send: true`
sends at once).

> `docs/agent-chat-surface.md` (the spec these rules cite) is not in the repo;
> the route and one-surface rules live as doc-comments in `PageDock.tsx` /
> `ChatDock.tsx`. R2 owns promoting them into a document.

## 3. Action status streams back

`RecommendedActionCard` proposes into the review queue and then follows the run
via `review.actionStatus` (`useActionRunStatus`, 2s → 30s backoff, stops on a
terminal status): *In review → Approved · running → Done / Failed / Rejected*,
with who decided and when. A reviewer can approve or reject inline — the same
`review.decideAction` route the review page uses; the card never bypasses
`ReviewService`.

## 4. Act within bounds

A conversation in `act-within-bounds` autonomy (R2 adds the toggle; the stream
route reads `body.autonomy` or the conversation row) has the agent's
recommendations filed into the review queue as they are emitted —
`services/chat/autoPropose.ts` — and the `recommended_action` event carries
`runId`, so the card renders queue status from the first frame. Nothing
executes: the run lands `pending`, and trust rules or a person decide it exactly
as they would a tapped card (Manifesto §8: automation is earned).

## Adoption

`chat.opened_from_context` (`meta.recordType`) is tracked when a turn arrives
with `openedFrom` and a record — the count against `chat.message_sent` says how
much of the conversation starts in context rather than cold.
