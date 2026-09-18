# Artifacts — one live thing beside the conversation

> **Note on the 2026-09-15 blog post.** It described a *canvas*: a grid of
> tiles you arranged beside a conversation, with empty slots you typed into.
> Product moved the same day. What shipped is a single **live artifact** open
> beside the chat, edited in place by both the person and the agent, with a
> version for every edit and a browsable log of all of them — the
> Claude.ai / Cloudflare model, not a configurable dashboard. The `canvas`
> table still exists and is unused; nothing reads or writes it, and it is
> slated for `DROP`.

A conversation with an agent used to end in prose. What the agent *made* — a
table it assembled, a chart, a plan, a record it found — was pasted into the
answer as markdown or written to a file whose URL the model mentioned.
Nothing knew what it was, which conversation produced it, or how to change it
without asking for the whole thing again.

The artifact model fixes that with three ideas:

1. **What an agent makes is a row**, with a typed `spec` that renders as a
   card in the chat and full-size in the pane.
2. **One artifact is open at a time**, and the person and the agent both edit
   *that one*. "Make the third column currency" moves what you are looking
   at; it does not produce a seventh near-duplicate.
3. **Every edit is a version**, whoever made it. The history is one trail, so
   "who changed this and why" has an answer.

## What exists

| Piece | Where | What it does |
|---|---|---|
| `artifact` table | `0095_artifact.sql` + `0101_artifact_version.sql`, `models/Schema.ts` | id, org, conversation, message, `kind` (`table` \| `markdown` \| `chart` \| `record` \| `link` \| `file`), `title`, `spec` jsonb, `url` (files), `folder`, `current_version`, `head_version_id`, `last_author_kind`/`last_author_id` |
| `artifact_version` table | `0101_artifact_version.sql` | one immutable row per edit: `version`, `title`, `spec`, `author_kind` (`agent` \| `human` \| `system`), `author_id`, `run_id`, `message_id`, `change_summary` |
| Card specs | `libs/cards/specs.ts` | zod schemas per kind — the tool validates with them, the card renders with them, the row stores what passes them |
| Cards | `libs/cards/firstParty/{dataTable,markdown,chart,record,link}.tsx` | surfaces `chat` (dense) and `artifact` (full). `resolveCard()` is the only render path |
| Create tools | `services/agents/tools/renderArtifacts.ts` | `render_table`, `render_markdown`, `render_chart`, `render_record` — validate, persist, emit `{ type: 'artifact' }`, return a one-line receipt |
| Guarantee | `services/agents/deliverableBackstop.ts` + `AgentService#applyTurnGuarantees` | a turn sent with `deliverable: 'artifact'` ends with one — wrapped, composed, or an explicit stub |
| Edit tools | `services/agents/tools/editArtifacts.ts` | `read_artifact`, `update_artifact` — how the agent changes what is already open |
| File tool | `services/agents/tools/createArtifact.ts` | `create_artifact` makes a downloadable FILE (CSV/SVG/doc) and records it as a `file` artifact. Unrelated to the live-artifact family, despite the name (it is a registered capability id in `libs/tools/catalog.ts`) |
| Event | `services/agents/types.ts` `AgentEvent` | `{ type: 'artifact'; artifact; pending?; delta? }` |
| Service | `services/ArtifactService.ts` | create / update / restore / list / versions / folders — the ONE door for agent and human writes |
| API | `routers/Artifacts.ts` → `client.artifacts.*` | `listForConversation`, `get`, `list`, `folders`, `update`, `setFolder`, `versions`, `version`, `restore`, `remove`, `exportPage` |
| Pane | `features/dashboard/artifacts/` | `ArtifactPane`, `artifactReducer`, the markdown + table editors, `VersionMenu` |
| Beside a chat | `/dashboard/chat/[id]?artifact=<id>` | transcript left, one artifact right |
| On its own | `/dashboard/artifacts/[id]` | the same pane, no conversation — where a "Copy link" lands |
| The log | `/dashboard/artifacts` | every artifact, newest edit first. `/dashboard/canvases` 308s here |

## How one appears, and then changes

1. The agent calls `render_table` (or another `render_*`) with a spec.
2. The tool validates it against `libs/cards/specs`, inserts the `artifact`
   row **and its v1**, and emits the `artifact` event.
3. The pane opens (or switches) to it; the turn gets a chip in the transcript
   ("📄 Release readiness · v1 created") that reopens it later.
4. The person says "sort by owner". The open artifact travels back as the
   turn's page context (`record: {type: 'artifact', id}`), so the model knows
   what "this" is; it calls `read_artifact`, then `update_artifact` with a
   `change_summary`. That is **v2**, and the pane updates live.
5. Or the person edits it themselves — markdown in a textarea, a table cell by
   cell — and saves. Same service, same history, `author_kind: human`.

`render_markdown` emits a **pending** shell first (title known, body not), so
a long write shows a filling outline rather than an empty column. The settled
event replaces the accumulated body, so a dropped delta cannot leave the pane
showing something the database does not hold. The fold is
`mergeArtifactEvent` in `features/dashboard/chat/traceReducer.ts` — pure, and
tested.

## Guaranteeing an artifact when one was asked for

Steps 1–3 above describe the happy path: the agent decides to render, and an
artifact appears. Leaving that decision to the model is exactly what broke —
*draft a pipeline report* came back as a sentence of narration and an empty
pane, and nothing in the surface could tell a deliberate decision from a
forgotten one.

So the decision is made **before the turn runs**, as a typed field on the
request: `deliverable: 'artifact' | 'answer'` (`libs/chat/deliverable.ts`),
armed by the person typing **`@artifact`** in the composer — the same
`@`-mention that tags a team or the page, offered in the same popover and, for
people who would rather point than remember the word, by a **`(+)`** beside the
box that types the tag into the draft at the caret. Explicit and discoverable
beat inferred: the first cut pre-armed a chip from a classifier reading the
draft, and an opt-in that arms itself is one you have to notice and undo. The
full contract and both paths are in
[agent-chat-surface.md](./agent-chat-surface.md#deliverables--this-turn-produces-an-artifact-is-a-contract-2026-09-16).

What this document owes is the other half: **what happens when the turn does
not render one.** `applyTurnGuarantees` in `services/AgentService.ts` runs
after every turn on every harness target, and `runDeliverableBackstop`
(`services/agents/deliverableBackstop.ts`) fires only when the turn was sent
with `deliverable: 'artifact'` and called none of `render_table`,
`render_markdown`, `render_chart`, `render_record`, `create_artifact`,
`update_artifact`:

| The answer is | What happens | Model? |
|---|---|---|
| long-form — headings, a markdown table, or ≥120 words | wrapped **verbatim** into a `markdown` artifact | no |
| short — narration, a promise, an apology | ONE gated pass over the turn's transcript and tool results produces the document | yes, once |
| short, and the pass fails or returns nothing usable | an explicit **stub**: *"\<subject\> — not completed"*, with `## What failed` and `## What is needed` | no |

Three things are deliberate:

- **The author is `system`, not `agent`.** The harness made it; the version
  history must not claim the agent chose to.
- **The change summary says why** — *"Captured from the turn's answer because
  an artifact was requested and none was rendered"* — so `/dashboard/artifacts`
  and the version menu distinguish these from an artifact the agent rendered
  on purpose.
- **Nothing is invented.** The gated pass is told, in as many words, that a
  fabricated document is worse than a stub. A stub is a legitimate artifact; a
  silent nothing is not.

The answer gains one sentence naming the artifact and saying why it exists,
streamed as a `response_delta` so the live transcript and the persisted message
say the same thing.

Turns sent with `deliverable: 'answer'`, or with no `deliverable` at all, cost
one set lookup and no IO — the guarantee is inert unless somebody asked for it.

## Versions

- Every write goes through `ArtifactService.updateArtifact`, which appends an
  `artifact_version` row and repoints the head. `artifact.title`/`spec` always
  mirror the head.
- **Restore never rewrites.** Restoring v2 writes v6 carrying v2's content, so
  the menu is a record of what happened rather than a record of what someone
  wishes had happened.
- **A burst of human saves collapses.** Saves by the same person inside
  `COLLAPSE_WINDOW_MS` (30s) fold into the head version — ⌘S-⌘S-⌘S is one
  version, not three. Agent writes never collapse, and one person's save never
  folds into another's.
- **Concurrent edits do not clobber.** A person's save carries `ifVersion`. If
  the agent moved the head meanwhile, the write is refused and the pane offers
  *Review theirs* or *Keep mine*; keeping mine re-sends without `ifVersion` and
  lands as the next version on top.

What is **not** a version: sorting or hiding a column (that is a view), and
moving an artifact between folders (that is metadata).

## Editing, by kind

| Kind | A person can |
|---|---|
| `markdown` | edit the body in a plain textarea, ⌘S to save; select text for "Ask Vocion" |
| `table` | edit cells, rename columns, change a column type, add/remove rows |
| `chart`, `record`, `link`, `file` | edit the title and the folder; the content comes from the agent |

The markdown editor is deliberately plain. A code editor here is a second
thing to learn for content that is mostly prose, and anyone who wants one
already has their own.

## The log

`/dashboard/artifacts` lists everything the workspace has made, newest edit
first: title, type, version count, last editor, when, folder, and the
conversation it came out of. Type chips and folder chips filter; search
matches the title. Pinned artifacts (the sidebar's own `user_nav_pref.pins`)
sort to the top. A row opens the conversation with that artifact in the pane,
or the standalone page when the conversation is gone.

**Folders** are flat path-like text (`revenue/weekly`), editable from the
pane header. No tree UI: a chip filter and a grouping line is the whole
feature, because a folder here is a label, not a filesystem.

Artifacts is a WORK row of `features/navigation/dashboardNav.ts` — the one
registry the sidebar, the ⌘K palette and the breadcrumb all read — where
Canvases used to be. There is no second list to keep in step.

Save, restore and move report through `components/ui/toast`: one pending toast
rewritten in place with the outcome. A save that FAILED says so, which is the
case that matters — otherwise a person keeps typing into a textarea that has
quietly stopped persisting.

## Export

*Export* turns one artifact into `pages/<slug>.yaml` + `pages/<slug>.md` — a
workspace page (`archetype: markdown`; a table becomes a GFM table). Charts,
records, links and files say plainly that there is no archetype for them yet.
Nothing is written to the workspace repo from the app; the person commits the
files. That is the manifesto's loop: a view one person needed once becomes a
page everyone has ([DESIGN-PRINCIPLES.md](./DESIGN-PRINCIPLES.md) §6–7).

## Serving files — never from `public/`

File artifacts (`create_artifact`, `generate_image`) are written to
`VOCION_ARTIFACTS_DIR` (default `<cwd>/.artifacts`) and served **only**
through `GET /api/artifacts/<id>/<filename>` — a dashboard session or a
`vcn_live_` token whose org owns the artifact; anything else is a 404. `<id>`
is the artifact row id or the content-addressed file id `<orgId>-<hash>`.
Responses are `Cache-Control: private`. A **card** artifact (table, markdown,
chart, record, link) has no file behind it — `GET /api/artifacts/<rowId>`
returns its spec as JSON (`{ artifact }`) instead.

**Never leave `VOCION_ARTIFACTS_DIR` under `public/` in production.** Next
serves `public/` to anyone with the URL; on 2026-09-15 a deployment with the
old default (`public/artifacts`) exposed revenue briefs unauthenticated. The
store logs a warning if it detects that layout in production. Legacy
`/artifacts/<file>` URLs stored in rows or prose are rewritten to the route by
`artifactHref()`. `VOCION_ARTIFACTS_URL_BASE` remains an override only for
deployments that serve the directory behind their own auth.

## Surfaces

`CardSurface` (`packages/sdk/src/cards.ts`) carries `'artifact'` where it
carried `'canvas'`. A card declares the surfaces it supports; all five
first-party cards support `chat` and `artifact`, plus the existing
run/review/activity surfaces.
