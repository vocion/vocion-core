# Search Engine Optimization — pages that rank, signed off early

**Search Engine Optimization** is a prebuilt app (id `seo`), the second marketing app beside [Paid Marketing](./marketing.md). An agency runs every client from one workspace: research what ranks on Google, plan pages on the strongest model and get the keyword plan signed off, write in each client's voice and rules, get a person's feedback on a sample of each kind of page before the rest are written, route that feedback to the client or the craft, and ship pages to the client's site with sign-off.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/seo/app.yaml` |
| **Plugin** | `seo` (`packages/core/templates/plugins/seo/`): four agents, the `seo` team, seven skills, the `seo-feedback` learning step, the `seo_batch` and `seo_page` types, two pages, trust rules, and the `seo-batches-moving` mission with its `seo-continue` automation. Depends on `data-rooms` (projects) and `wiki` |
| **Pages** | `/dashboard/p/seo` (every batch, its gate line, pages by status) and `/dashboard/p/seo-pages?batch=<id>` (a batch's pages) — descriptor pages over the two records |
| **Core** | `services/seo/` — `gate.ts` (the volume gate, per project), `records.ts` (batches and pages, the gate written back on every write, per-key merges under a row lock), `signoff.ts` (the plan and page sign-offs, filed and heard in code), `meta.ts` (meta title, description and slug), `modelThatRan.ts`, `projects.ts`; tools in `services/agents/tools/seo.ts` |
| **Research** | `serp_search` (with the local pack), `keyword_cluster` (one page per set of keywords whose top 10s share 3+ URLs), `serp_compare` (files the SERP brief in `seo/serp`, directories flagged, the pages' text and shared terms, then writes its synthesis with `brief_id`; Google's ranking only), `keyword_metrics` (volume and keyword ideas), granted with `harness.grantTools: [serp]`. See [SEO research](../guides/seo-research.md). Serper, the default provider, gives no volume or ideas: the skills carry on without them and never estimate one |
| **Publishing** | `site.publish_page` to a project's publish targets (a GitHub pull request, a Squarespace draft) |

## The seats and their models

| Agent | Does | Model |
|---|---|---|
| `seo-strategist` (lead) | Onboards clients, plans batches, writes briefs, routes feedback, publishes | Opus 5.5 |
| `serp-analyst` | What ranks and what those pages are made of: the SERP brief | Sonnet 5.5 |
| `seo-writer` | One page from its brief, in the client's voice and rules | Opus 5.5 |
| `seo-editor` | Checks every draft against the client's rules, brand, guidelines and the SERP brief before a person sees it | Sonnet 5.5 |

Each seat pins its model (`harness.modelProvider` + `harness.model`). A teammate consulted through `task` runs on its own pinned model rather than the lead's legwork model (`teammateModels`, `services/agents/harness.ts`), so the writer writes on Opus 5.5 whoever asks it; a pinned model that cannot be built is logged as an error and the teammate is left out with the lead told why, never quietly run on the fast model. A consulted teammate reads its OWN skills (mounted at `/teammates/<slug>/skills/`) and gets its own `harness.grantTools` on top of the lead's tools.

The page records **the model that actually ran** each step — the model the response that made that tool call reported, read from the calling loop's own messages, so a teammate's step is stamped with the teammate's call rather than whatever ran last in the conversation. Only when no message is there to read (a tool called back from the agent runtime) is the ledger (`model_call`) read, and only when no call was logged at all is the seat's pinned model shown, marked "(configured)". The batch page shows it: "Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5".

## Clients are projects

Each client is one project (today's data room): its **rules** (checked against every draft), its **notes** (the client wiki: voice, services, audience, competitors, content inventory), its brand, and guideline documents filed at three stars. `onboard-client` builds it from the client's site. Every `seo_batch` and `seo_page` carries `metadata.projectId`.

Two project settings are a **person's**, set under "Publishing" on the project page (`PATCH /api/v1/projects/:id`, a signed-in person only): the gate sizes (`seoGate`) and where pages publish (`publishTargets`). No agent can change them: `objects.update_meta` (the action behind `update_object`) refuses both keys on a project whoever proposed the write (`PERSON_ONLY_FIELDS`), and `update_project` does not take them.

## The keyword plan

`seo_plan_batch` creates the batch in `plan_review` and files ONE sign-off ask (`seo-plan:<batch>:<round>`) whose context is the keyword map: keyword, page type (`location`, `service`, `blog`, `landing`, `other`), location, intent, cluster, and the target — a new page or the live URL it refreshes. Briefs and drafts are refused until it is approved; SERP research may go on meanwhile. **Revise** holds the batch with the person's note on it (`plan.note`); the strategist answers it with `seo_plan_batch` and `batch_id`, which replaces the proposed pages and files the next round. **Discard** takes the batch's pages out.

## Page types and local search

Every `seo_page` may carry a **page type** (`location`, `service`, `blog`, `landing`, `other`), a
**location** (the city or area a location page is for), an **existing URL** (the live page a refresh
rewrites) and a planned **slug**; `target` (published URL, else existing URL, else slug) is stamped on
every write, and the pages list shows type, location and target. Three rules hold in code:

1. **Its own city's results.** `seo_save_research` refuses, for a location page, a SERP brief whose
   query does not name its location, and a brief already attached to another location page.
2. **Local substance.** `seo_save_brief` refuses a location page's brief with no section headed
   "Local substance": what is true of that place for the client, from the project.
3. **No doorway pages.** `seo_save_review` compares a location page's draft with every other
   location draft in the batch: plain text, both cities masked, five-word shingles, Jaccard. At 0.7
   or more it records `fix` whatever the editor said, names the sibling and the score
   (`review.similarTo`), and sends the page back to the writer (`services/seo/duplicates.ts`).

## One keyword, one page

`seo_plan_batch` refuses a page whose keyword the project already has in another open batch or on a
published page, or whose slug or existing URL another page lives at or refreshes, and the same
keyword twice in one plan, unless the page is marked `refresh` with the `existing_url` it rewrites
(`planConflicts`, `services/seo/records.ts`). Plan from `keyword_cluster` so each page targets one
cluster.

## The volume gate

Enforced in code (`services/seo/gate.ts`), never by a prompt, and **per project**: every batch of one client climbs one ladder, in the order the batches were planned, over the pages of signed-off plans.

1. **Sample.** One page of each page type in the plan (the first of each, in order), filled up to the sample size (3). Nothing else is drafted, in any batch of the project, until a person has signed off on every one. A page with no type yet counts as its own kind.
2. **Tranche.** Then the next 10, and nothing past them until every page so far is approved.
3. **Open.** Then the rest.

A page sent back with changes holds every new draft in every batch of the project until its feedback is filed; once filed, the page itself is redrafted, and the stage does not advance until it is approved. Sizes are per project: `seoGate: {sample: 3, tranche: 10}` (whole numbers 1 to 100; anything else reads as the default), set by a person.

`seo_save_draft` refuses a page the gate has not released and says why. Approval is read from a person's sign-off on the **current words**: the same draft artifact, the same round, and the artifact version and content hash the ask showed (`signoff.version`, `signoff.hash`, written only by `signoff.ts`) — never from a status an agent could write. An edit to the draft after it was sent for sign-off or signed off puts the page back to `in_review` with a new ask (`onSeoDraftRevised`, from the artifact save), and the gate counts it as not approved meanwhile. The gate is written back onto every batch of the project on each page write, so the SEO page shows it in one line: "3 of 40 written · waiting on your feedback on the sample of 3". Page writes merge per key under a row lock, so a sign-off landing mid-write is never lost.

## The tools

| Tool | What it does |
|---|---|
| `seo_plan_batch` | A batch and its keyword plan, in writing order, for one project, each page with its page type, location, cluster, slug or existing URL; refuses a keyword or URL the project already has unless it is a refresh; files the plan's sign-off and stops. With `batch_id`, revises a plan sent back |
| `seo_next_pages` | What the project's gate lets be written now, each page's next step, why the rest wait, and the client's adopted rules (`clientRulesFromSignoffs`) |
| `seo_start_writing` | Queues the released pages of a batch for the background run; the chat turn only starts it |
| `seo_save_research` | The SERP brief `serp_compare` filed (folder `seo/serp`) on a page; refuses another artifact, a brief whose synthesis is not written yet, one built on web search results, and for a location page one not read for its own city |
| `seo_save_brief` | The page brief on a page (refused until the plan is signed off; a location page's needs its "Local substance" section); records the planning model |
| `seo_save_draft` | The draft on a page with `meta_title` (at most 60, said at 55+), `meta_description` (at most 155) and `slug` (the planned one stands when left out; kebab-case, path segments allowed, unique in the project), stored as `metaTitle`, `metaDescription`, `slug` (refused past the gate, without a brief, or with meta that does not pass); withdraws an open ask from an earlier round; records the writing model |
| `seo_save_review` | The editor's verdict with `findings`; `pass` files the page's sign-off itself, `fix` withdraws any open one and queues the writer's revision (3 rounds, then the sign-off with the findings open); a location draft 70%+ the same as a sibling is sent back whatever the verdict |
| `seo_record_feedback` | A note on a page, its scope (client or general) and where it was filed, checked |

Present while the `seo` plugin is on (`services/agents/tools/registry.ts`).

## Sign-off and feedback

Code files every sign-off, never the model: on the editor's `pass`, `seo_save_review` files core's `signoff` ask with `source_ref: seo-page:<page>:<draft>:<round>`, the draft and the page as its records, grouped under the batch on Needs you, and writes the version and hash it showed onto the page (`signoffAsk`). A redraft, a `fix` or a request for changes in words withdraws the open one. The answer comes back through `AskService.settleWaitersOn`: **Approve** approves the page, **Revise** (the answer in the person's words) records the note on the page and sends it back, **Discard** takes it out of the batch. Each draft round has its own ask, so an answer about an older draft moves nothing. After either sign-off settles, core raises `seo.work_queued` (reason `signoff`), and the plugin's `seo-continue` automation wakes the strategist on its `seo-batches-moving` mission to continue the released pages — nobody has to ask.

## Writing runs in the background, and the editor's loop is code

Drafting and review never run inside a person's chat turn (a live run hit the turn's spend ceiling mid-review): `seo_save_draft` and `seo_save_review` refuse outside a run, and in chat the strategist calls `seo_start_writing`, which queues the released pages (`seo.work_queued`, reason `write`) and says what is running. The `seo-continue` automation runs the strategist's mission as a durable mission run — its own budget on the SEO team's seats, resumable like any mission run — and progress lands on the batch and page records and, when the work was started from a conversation, in it (`tellConversation`, `services/seo/work.ts`).

The editor gives `findings` (a list of `{ issue, location, fix }`, each field kept to 600 characters) and notes of any length: a review longer than the page keeps, or one with findings, is stored whole as an artifact in `seo/reviews` linked from the page (`review.notesArtifactId`), so a review is never lost to a limit. A `fix` queues the writer's revision with the findings (reason `revise`) and then the editor's review again, counted on the page (`editorRounds`); after 3 rounds the sign-off is filed anyway with the open findings shown, and the person decides. Only a pass or exhausted rounds reaches a person; a person's answer starts the count again.

`feedback-to-wiki` then routes each note, to the page's own project or the learning step, and `seo_record_feedback` checks the filing before the gate counts it:

- **client** → `update_project` with `project_id` set to the page's project (SEO seats must name it; "the project on screen" is refused). `update_project` writes directly: there is no Review step. Then `filed_to: project:<that id>` with `filed_text`, which must be on that project's rules or notes; another project's id is refused.
- **general** (craft) → `filed_to: learning:seo-feedback` with the rule as `filed_text`. The tool files it as a learning candidate (`sourceRef` names the page and project) for a person to adopt at /dashboard/learnings; adopted rules mount for the writer and the editor. A client's note filed this way is scoped to its project (`data_room/<id>`) and, once adopted, reaches only that project's pages (through `seo_next_pages`).

A candidate that was rejected, a note filed to another client, or words that are not on the project do not count as filed. SEO sign-offs skip the generic learning-from-decision path, so a note is never proposed twice or filed for every client. There is no SEO wiki page: the learning step is the one place craft is read from.

## Measures

The `seo` team is graded on **pages published** (observed, `site.publish_page` runs), **pages a person signed off** (human-confirmed, `signoff` asks answered Approve — a Revise is not a sign-off) and **drafts written** (artifacts in `seo/drafts`), never on drafts alone.

## Trust

`trust.yaml` holds a direct agent write to a page (`objects.update_meta.seo_page`) and every publish (`site.publish_page`) for a person; batch fields run within bounds. The gate itself is not a trust rule: it is code, and so are the person-only project settings.

## Installing it on Vocion Cloud

Adding Search Engine Optimization to a workspace with no folder sets the whole app up through `services/plugins/installBundle.ts`: Data rooms and the Wiki with it, the four agents (the strategist becomes the workspace lead when the workspace has only the generic one), the team, the two record types, the learning step and the trust rules (`services/seo/seo.pglite.test.ts`). Then onboard a client from their website.
