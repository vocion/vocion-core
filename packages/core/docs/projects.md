# Projects

> The collection around one client or engagement — and how a workspace extends it.

**Renamed 2026-10-27.** Projects were called *data rooms*. Every label a
person or a model reads says Project; the internal names did not move: the
record type slug is `data_room`, the plugin is `data-rooms`, an open item's
ask group is `data-room:<id>`, the service is `services/DataRoomService.ts`
and the env var is `VOCION_DATA_ROOM_AUTOFILE`. The old paths redirect
(`/dashboard/rooms[/id]` → `/dashboard/projects[/id]`, 308) or answer the same
(`/api/v1/rooms/:id`, `/sources`, `/export`), and the old tool names
(`list_data_rooms`, `read_data_room`, `create_data_room`, `update_data_room`,
`file_to_data_room`, `unfile_from_data_room`) and the `room_id` argument still
resolve for one release (`services/agents/tools/toolAliases.ts`).

## A core workspace noun

A project persists within a workspace across apps. The Projects page
(`/dashboard/projects`) is a Workspace row that is always there, like Chat and
Review, so it shows in the sidebar of every app the workspace has; no app owns
it. The project tools (`list_projects`, `read_project`, `create_project`,
`update_project`, `file_to_project`, `unfile_from_project`, `add_open_item`)
are on in every workspace. The `data-rooms` plugin adds what keeps projects
current on their own: the full type schema, the skill, the Project keeper
and its mission, the after-sync collector, and the team. Without it a minimal
`data_room` type is created on first use. Link one with `projectHref(id)`.

## The core definition

A **project** is the collection of ingested objects and generated artifacts
related to one entity, plus the standing knowledge that keeps the collection
growing on its own. That is the whole of it in core. Everything a use case
adds — a proposal, a ticket board, a case study — is an extension by a
workspace, never a second noun.

The entity is the project's **anchor**: a CRM deal at Proposal stage, a company,
a project, a ticket. The anchor moves as the relationship does (Discovery →
Proposal → Signed → In delivery) and the project persists through all of it. A
sales project *is* the engagement project later; nothing is copied across.

```
data_room (business_object)
├── anchor        the entity: { type, system, id, url, label }
├── rules[]       the Instructions: how to collect, associate and work the project — read first
├── notes         the Wiki, the client wiki (markdown)
├── status        one dated paragraph
├── cast[]        who is on it, which side
├── sources[]     what is filed, by weight, with provenance and who filed it
├── milestones[]  the dated timeline — planned and done
├── highlights[]  quotes, metrics, wins, challenges — the case study's raw material
├── deliverables[]
├── domains[] / aliases[]   how material is matched to the project
├── brand         the CLIENT's logo and mark, as data URIs with the URL each came from
├── publishTargets[]  where its pages ship: { id, kind: github | squarespace | wordpress, label, config }
└── open items    asks grouped under data-room:<id>
    artifacts     decision logs, documents, working files — anchored to the record
    work          any record whose metadata.projectId names the project
```

Every line maps onto a noun core already has (design principle 7):

| In the project | Core noun | Why |
|---|---|---|
| A filed transcript, thread, attachment | `knowledge_document` + `object_document_link`, provenance in `metadata.sources` | Ingestion, search and retention are already solved |
| A decision log, a proposal, an architecture note, a plan | `artifact` anchored to the record (`recordType = 'object'`), grouped by `recordRole` prefix | Versions, preview, share, log for free |
| An open item, a ticket | `ask` under `data-room:<id>` | Needs-you is already the work queue |
| The wiki, rules, timeline, highlights | fields on the record, governed by the object type's JSON schema | The workspace's `objects/data_room/type.yaml` extends them |
| The proposal | `document` artifact with `spec.playbook = 'proposal'` | The playbook is the subclass — the skill carries the framework |
| The client's logo | `brand` on the project's metadata, fetched by `fetch_image` | The client's mark is a fact about the client, not about one document — fetched once, reused by every document the project produces, and printed in the project's export so the writer inlines the real one instead of drawing a wordmark |

## The project page

The page reads as the client's home: **Status**; **Instructions** (`rules`,
edited in place); **Brand & guidelines** (the client's logo and mark, and the
attachments and notes filed at ⭐⭐⭐); **Wiki** (`notes`, edited in place);
the other **Sources** by weight; **Work**; **Open items**; then what is only
promised, the timeline, the highlights and the decision logs. **Publishes to**
sits in the right column, read-only, when `publishTargets` holds any.

## Connections that belong to a project

An agency runs many clients in one workspace, and client A's GitHub or
Squarespace must never be usable for client B's work. So a connection (a
`knowledge_source` row) can belong to one project: `data_room_id`, the
project's record id. Null is the whole workspace, which is every connection
made before this (migration `0231_connection_project.sql`). It is named after
the internal type because `knowledge_source.project_id` is the workspace.

**The rule, in one place** (`services/connect/connectionScope.ts`): work for
project P may use the workspace's connections and P's, never another
project's; work for no project uses the workspace's only.
`connectionsFor(orgId, { projectId })` is the resolver, and every credential
lookup that serves work reads through it:

| What | Where |
|---|---|
| A GitHub token for a repository, and its deploy branch | `repoAccess` / `tokenForRepo` / `sourceConfigForRepo` (`githubPullRead.ts`), so `ghFor`, the factory, the runners and repo reads |
| A credential named by slug (the direct tools, the action runner) | `resolveApiTokenIdForSource` |
| The connector families (tracker, finance, ads, analytics, warehouse, chat, people, repo) | `familySourcesForOrg` |
| Publishing: the GitHub pull request, the Squarespace sign-in and login | `publishTargetScopeRefusal`, `squarespaceConnectionFor`, `squarespaceLogin` |
| An agent turn's sources and its retrieval | `runtimeContextFromScope` drops withheld slugs; `search_knowledge` excludes them |
| A sync, and what the collector files after it | a project's connection syncs as that project's work and files only into it |

**The work's project** is decided where work starts and rides the call
context (`workProjectId`) to every lookup below it, and the agent's
`RuntimeContext` (`workProjectId`, `withheldSourceSlugs`); across the
AgentCore container it is signed into the tool claim. In order:

1. a project named outright: an SEO page's or batch's `projectId`, a job's
   input (`libs/durable/jobs.ts`), a mission run started for one
   (`mission_run.data_room_id`, `startMission({ projectId })`);
2. the conversation's scope: `scope_ref` `project:<id>`, set when a
   conversation is started on a project's page or a record of one;
3. the record the conversation was opened about, then the record the page
   shows — a project, or a record whose `metadata.projectId` names one.

Nothing named means the workspace's connections only.

**Refusals say so**, naming the project (principle 10): "GitHub for
example-org/northwind-site is connected for project Northwind Home Services,
not for this work." A tool returns it, a publish stops on it, and a project's
publish target is refused when it is saved.

**On the page.** The project's **Connections** section lists its own
connections; **Connect for this project** opens Connectors with the project
chosen (`?project=<id>`), through a vendor's login too. **Ask about this
project** opens a conversation scoped to it, and the conversation's header
shows the project chip. On Connectors every row says "Whole workspace" or the
project's name, and Manage moves it (`Scope: Whole workspace / Project ▾`).

## Records belong to a project

Any `business_object` belongs to a project by carrying the project's id in
`metadata.projectId` (a number). Nothing else is needed: no link table, no
type-specific code. `listBusinessObjectsForProject(orgId, projectId)` in
`services/BusinessObjectService.ts` lists them (and `listBusinessObjectPage`
takes a `projectId` filter). The project page's **Work** section groups them by
their type's label, each linking to its own record page, with the documents
and working files anchored to the project beside them; the bundle an agent
reads (`read_project`) lists them under `## Work`. An app that makes records
for a client's project (SEO pages and batches, for example) sets
`metadata.projectId` and they appear there.

## Done for you, with undo

The project grows without a filing step. After every source sync the
**collector** (`services/dataRooms/collector.ts`) scores what the run touched
against the open projects with the same rule the `file_to_project` tool uses:

- a **clear match** files the document as an `auto` source carrying its score
  and evidence, both shown on the project page beside a Remove that undoes it;
- a **plausible match** becomes the "file this into X?" ask;
- **no match** does nothing — a sync is no place to ask about every internal call.

A removed document is remembered on the project (`unfiled`) and never re-filed on
its own; a deliberate filing lifts that. A HubSpot deal that a sync shows at a
Proposal stage with no project gets one, anchored to the deal, with the deal's
name as an alias so its calls file themselves from then on. Closing the project is
the undo. `VOCION_DATA_ROOM_AUTOFILE=0` switches the collector off; a project's
`autoFile: false` opts one project out.

## Instructions and wiki

`read_project` puts the **rules** (Instructions) first because they govern everything under
them — how the client names things, what files here, who signs off. When a
person corrects the agent about an engagement, the correction becomes a rule
so it holds next time. The **notes** are the Wiki: durable knowledge in
markdown, appended in dated sections. Both are edited in place on the project
page (PATCH `/api/v1/projects/:id`) or by the agent (`update_project`).

## Extending the project for a use case

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
   (`services/proposals/board.ts`) is a read over projects at a Proposal stage and
   their latest `document` — a surface the workspace switches on, not a table.

### Mapping the engagement dataroom repo

Jamie's `scaffold-dataroom` skill stands up a git folder per client. Each part
has a home in the project:

| Folder / file | Project |
|---|---|
| `meeting-transcripts/` | sources (kind `transcript`, filed by the collector from Zoom and Granola) |
| `tickets/` + `board.html` | open items (asks); the board is Needs-you filtered to the project |
| `MILESTONES.md` | `milestones` |
| `CASE-STUDY-MATERIAL.md` | `highlights` |
| `CLAUDE.md` working rules and terminology | `rules` (per project) + the workspace skill (per engagement type) |
| `README.md`, wiki pages | `notes` |
| `artifacts/`, `architecture/`, `project-management/` | artifacts anchored to the project with `recordRole` `artifact:`, `architecture:`, `update:` — the page groups them as working files |
| `sales-context/` | the same project, earlier in its life: the stage was Proposal |
| `BRAND.md`, `tools/` deck kit | `brand.yaml` + `get_brand`, and the document engine |

What does not move into the project: code. An operational repo stays a repo; the
project links to it through an artifact of kind `link` or a rule ("the code is in
`ping-post-operations`; work there in a worktree per ticket").

## Reading a project

`GET /api/v1/projects/:id/export` and the `read_project` tool return the same
markdown bundle (`renderDataRoom`): instructions, where it publishes, status,
wiki, entity, sources by weight with who filed each, timeline, highlights,
open items, every decision log, the outline of every document, the records
that belong to it, the working files. What the agent writes
from is what a person can download and check (principle 10).
