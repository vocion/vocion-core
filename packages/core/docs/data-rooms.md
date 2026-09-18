# Data rooms

> The collection around one entity — and how a workspace extends it.

## The core definition

A **data room** is the collection of ingested objects and generated artifacts
related to one entity, plus the standing knowledge that keeps the collection
growing on its own. That is the whole of it in core. Everything a use case
adds — a proposal, a ticket board, a case study — is an extension by a
workspace, never a second noun.

The entity is the room's **anchor**: a CRM deal at Proposal stage, a company,
a project, a ticket. The anchor moves as the relationship does (Discovery →
Proposal → Signed → In delivery) and the room persists through all of it. A
sales room *is* the engagement room later; nothing is copied across.

```
data_room (business_object)
├── anchor        the entity: { type, system, id, url, label }
├── rules[]       how to collect, associate and work the room — read first
├── notes         the wiki (markdown)
├── status        one dated paragraph
├── cast[]        who is on it, which side
├── sources[]     what is filed, by weight, with provenance and who filed it
├── milestones[]  the dated timeline — planned and done
├── highlights[]  quotes, metrics, wins, challenges — the case study's raw material
├── deliverables[]
├── domains[] / aliases[]   how material is matched to the room
└── open items    asks grouped under data-room:<id>
    artifacts     decision logs, documents, working files — anchored to the record
```

Every line maps onto a noun core already has (design principle 7):

| In the room | Core noun | Why |
|---|---|---|
| A filed transcript, thread, attachment | `knowledge_document` + `object_document_link`, provenance in `metadata.sources` | Ingestion, search and retention are already solved |
| A decision log, a proposal, an architecture note, a plan | `artifact` anchored to the record (`recordType = 'object'`), grouped by `recordRole` prefix | Versions, preview, share, log for free |
| An open item, a ticket | `ask` under `data-room:<id>` | Needs-you is already the work queue |
| The wiki, rules, timeline, highlights | fields on the record, governed by the object type's JSON schema | The workspace's `objects/data_room/type.yaml` extends them |
| The proposal | `document` artifact with `spec.playbook = 'proposal'` | The playbook is the subclass — the skill carries the framework |

## Done for you, with undo

The room grows without a filing step. After every source sync the
**collector** (`services/dataRooms/collector.ts`) scores what the run touched
against the open rooms with the same rule the `file_to_data_room` tool uses:

- a **clear match** files the document as an `auto` source carrying its score
  and evidence, both shown on the room page beside a Remove that undoes it;
- a **plausible match** becomes the "file this into X?" ask;
- **no match** does nothing — a sync is no place to ask about every internal call.

A removed document is remembered on the room (`unfiled`) and never re-filed on
its own; a deliberate filing lifts that. A HubSpot deal that a sync shows at a
Proposal stage with no room gets one, anchored to the deal, with the deal's
name as an alias so its calls file themselves from then on. Closing the room is
the undo. `VOCION_DATA_ROOM_AUTOFILE=0` switches the collector off; a room's
`autoFile: false` opts one room out.

## Rules and notes

`read_data_room` puts the **rules** first because they govern everything under
them — how the client names things, what files here, who signs off. When a
person corrects the agent about an engagement, the correction becomes a rule
so it holds next time. The **notes** are the wiki: durable knowledge in
markdown, appended in dated sections. Both are edited in place on the room
page (PATCH `/api/v1/rooms/:id`) or by the agent (`update_data_room`).

## Extending the room for a use case

Everything that is true of one seller, one client or one motion lives in the
workspace (principle 12). Three extension points, all present today:

1. **The object type** — `objects/data_room/type.yaml` widens the metadata
   schema and the classification prompt. Add a `board` field, a `phase`
   vocabulary, a `caseStudy` block; core stores and renders what the schema
   describes.
2. **Skills** — `skills/data-rooms/SKILL.md` says how to file, log, rule and
   highlight. A workspace overrides it by slug. The engagement dataroom's
   `CLAUDE.md` rules (capture case-study material as it appears; keep the
   milestone timeline current; branch-and-ticket discipline) are skill text.
3. **Document playbooks** — a `document` artifact's `spec.playbook` names the
   skill that shaped it. `proposal-document` is one; `scope`,
   `partnership-update`, `delivery-summary` are others. The Proposals app
   (`services/proposals/board.ts`) is a read over rooms at a Proposal stage and
   their latest `document` — a surface the workspace switches on, not a table.

### Mapping the engagement dataroom repo

Jamie's `scaffold-dataroom` skill stands up a git folder per client. Each part
has a home in the room:

| Folder / file | Room |
|---|---|
| `meeting-transcripts/` | sources (kind `transcript`, filed by the collector from Zoom and Granola) |
| `tickets/` + `board.html` | open items (asks); the board is Needs-you filtered to the room |
| `MILESTONES.md` | `milestones` |
| `CASE-STUDY-MATERIAL.md` | `highlights` |
| `CLAUDE.md` working rules and terminology | `rules` (per room) + the workspace skill (per engagement type) |
| `README.md`, wiki pages | `notes` |
| `artifacts/`, `architecture/`, `project-management/` | artifacts anchored to the room with `recordRole` `artifact:`, `architecture:`, `update:` — the page groups them as working files |
| `sales-context/` | the same room, earlier in its life: the stage was Proposal |
| `BRAND.md`, `tools/` deck kit | `brand.yaml` + `get_brand`, and the document engine |

What does not move into the room: code. An operational repo stays a repo; the
room links to it through an artifact of kind `link` or a rule ("the code is in
`ping-post-operations`; work there in a worktree per ticket").

## Reading a room

`GET /api/v1/rooms/:id/export` and the `read_data_room` tool return the same
markdown bundle (`renderDataRoom`): rules, status, notes, entity, sources by
weight with who filed each, timeline, highlights, open items, every decision
log, the outline of every document, the working files. What the agent writes
from is what a person can download and check (principle 10).
