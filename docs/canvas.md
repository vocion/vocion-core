# Canvas — rendered output as data

A conversation with an agent used to end in prose. What the agent *rendered* —
a table it assembled, a chart, a plan, a record it found — was either pasted
into the answer as markdown or written to a file whose URL the model mentioned.
Nothing knew what it was, which conversation produced it, or how to show it again.

The canvas fixes that with one idea: **rendered output is an `artifact` row**
with a typed spec, and the same spec renders as a compact card in the chat and
as a full tile on the canvas beside the conversation.

## What exists

| Piece | Where | What it does |
|---|---|---|
| `artifact` table | migration `0095_artifact.sql`, `models/Schema.ts` | id, org, conversation, message, `kind` (`table` \| `markdown` \| `chart` \| `record` \| `link` \| `file`), `title`, `spec` jsonb, `url` (files), `tile` `{slot, span}`, `pinned` |
| `canvas` table | same migration | a named, saved arrangement: `name`, `layout` `[{artifactId, slot, span}]`, the conversation it came from |
| Card specs | `libs/cards/specs.ts` | zod schemas per kind — the tool validates with them, the card renders with them, the row stores what passes them |
| Cards | `libs/cards/firstParty/{dataTable,markdown,chart,record,link}.tsx` | registered in `firstParty/index.ts`; render on surfaces `chat` (dense) and `canvas` (full). `resolveCard()` is the only render path |
| Tools | `services/agents/tools/renderArtifacts.ts` | `render_table`, `render_markdown`, `render_chart`, `render_record` — validate, persist, emit `{ type: 'artifact' }`, return a one-line receipt. On for every agent (no side effect outside the conversation) |
| Event | `services/agents/types.ts` `AgentEvent` | `{ type: 'artifact'; artifact: ArtifactPayload }` |
| Service | `services/ArtifactService.ts` | create / list / tile / pin / canvas save / reopen / export |
| API | `routers/Artifacts.ts` → `client.artifacts.*` | `listForConversation`, `placeTiles`, `setPinned`, `canvases.{save,list,get,exportPage}` |
| Full view | `/dashboard/chat/[id]?grid=open` | chat left, canvas right (`features/dashboard/canvas/`) |
| Saved canvases | `/dashboard/canvases` | reopen; export as a workspace page |

`create_artifact` (files: CSV, SVG, doc) now also writes a `file` row, so a
mission's artifacts are rows, not regex-harvested URLs. The regex stays for
older runs.

## How a tile appears

1. The agent calls `render_table` (or another `render_*`) with a spec.
2. The tool validates it against `libs/cards/specs`, inserts the `artifact` row
   on the next free canvas slot (or the slot the person asked for), and emits
   the `artifact` event on the stream.
3. The chat shows the card inline (dense); the canvas places the tile (full).
4. The person drags, resizes (1–3 columns), hides, or expands it. Placement
   persists per artifact.

**Empty tiles.** The canvas always shows placeholder slots. Typing into one and
pressing ⏎ sends `Fill tile N: <text>` as a normal turn; the model passes
`tile_slot: N` on its `render_*` call and the artifact lands in that slot. Esc
clears the draft.

## Save and export

*Save canvas* names the current arrangement (`canvas` row + copied layout) and
lists it at `/dashboard/canvases`. *Export as page* turns a saved canvas into
`pages/<slug>.yaml` + `pages/<slug>.md` (`archetype: markdown`; markdown tiles
become sections, tables become GFM tables). Charts, records, links and files
are listed as not exported — there is no page archetype for them yet. Nothing
is written to the workspace repo from the app; the person commits the files.
That is the manifesto's loop: a view one person needed once becomes a page
everyone has ([MANIFESTO.md](./MANIFESTO.md) §6–7).

## Surfaces

`CardSurface` (`packages/sdk/src/cards.ts`) gained `'canvas'`. A card declares
the surfaces it supports; all five canvas cards support both `chat` and
`canvas`, plus the existing run/review/activity surfaces.
