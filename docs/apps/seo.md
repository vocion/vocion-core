# Search Engine Optimization — pages that rank, signed off early

**Search Engine Optimization** is a prebuilt app (id `seo`), the second marketing app beside [Paid Marketing](./marketing.md). An agency runs every client from one workspace: research what ranks on Google, plan pages on the strongest model and get the keyword plan signed off, write in each client's voice and rules, get a person's feedback on a sample of each kind of page before the rest are written, route that feedback to the client or the craft, and ship pages to the client's site with sign-off.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/seo/app.yaml` |
| **Plugin** | `seo` (`packages/core/templates/plugins/seo/`): four agents, the `seo` team, seven skills, the `seo-feedback` learning step, the `seo_batch` and `seo_page` types, two pages, trust rules, and the `seo-batches-moving` mission with its two automations: `seo-continue` (system plumbing, the background hand-off) and `seo-opportunities` ("New page opportunities", weekly). Depends on `data-rooms` (projects) and `wiki` |
| **Pages** | `/dashboard/p/seo` (every batch, its gate line, pages by status) and `/dashboard/p/seo-pages?batch=<id>` (a batch's pages) — descriptor pages over the two records |
| **Core** | `services/seo/` — `gate.ts` (the volume gate, per project), `records.ts` (batches and pages, the gate written back on every write, per-key merges under a row lock), `signoff.ts` (the plan and page sign-offs, filed and heard in code), `cadence.ts` (pages a month, and the weekly check), `meta.ts` (meta title, description and slug), `modelThatRan.ts`, `projects.ts`; tools in `services/agents/tools/seo.ts` |
| **Research** | `serp_search` (with the local pack), `keyword_cluster` (one page per set of keywords whose top 10s share 3+ URLs), `serp_compare` (files the SERP brief in `seo/serp`, directories flagged, the pages' text and shared terms, then writes its synthesis with `brief_id`; Google's ranking only), `keyword_metrics` (volume and keyword ideas) and `record_competitors`, granted with `harness.grantTools: [serp]`; `site_inventory`, granted by name. See [SEO research](../guides/seo-research.md). Serper, the default provider, gives no volume or ideas: the skills carry on without them and never estimate one |
| **Publishing** | `site.publish_page` to a project's publish targets (a GitHub pull request, a Squarespace draft) |

## The seats and their models

Every SEO seat runs a person's chat turn at Standard (`harness.turnEffort: standard`), never Quick, and Auto never runs a turn that publishes, sends or changes something outside the workspace at Quick either (`effort.ts`, the `outward` fact).

| Agent | Does | Model |
|---|---|---|
| `seo-strategist` (lead) | Onboards clients, plans batches, writes briefs, routes feedback, publishes | Opus 5.5 |
| `serp-analyst` | What ranks and what those pages are made of: the SERP brief | Sonnet 5.5 |
| `seo-writer` | One page from its brief, in the client's voice and rules | Opus 5.5 |
| `seo-editor` | Checks every draft against the client's rules, brand, guidelines and the SERP brief before a person sees it | Sonnet 5.5 |

Each seat pins its model (`harness.modelProvider` + `harness.model`). A teammate consulted through `task` runs on its own pinned model rather than the lead's legwork model (`teammateModels`, `services/agents/harness.ts`), so the writer writes on Opus 5.5 whoever asks it; a pinned model that cannot be built is logged as an error and the teammate is left out with the lead told why, never quietly run on the fast model. A consulted teammate reads its OWN skills (mounted at `/teammates/<slug>/skills/`) and gets its own `harness.grantTools` on top of the lead's tools.

**The SEO tools are never behind tool search.** A teammate on its own model gets the lead's tiered tools (`toolTiers.ts`: what the lead used lately stays loaded, the rest waits behind Anthropic's tool search). Every `seo_*` tool carries `metadata.alwaysLoaded`, so the writer and the editor always see `seo_read_page`, `seo_save_draft` and `seo_save_review`, and a teammate handed deferred tools is told it can search for the rest, as the lead is. A deferred tool is a copy (`deferColdTools`), so a teammate on the fast model still gets every tool in full. Found on a live run (2026-10-27): the editor, consulted in the background, said it could not open the draft, the brief or the SERP brief, and filed an ask instead of reviewing.

The page records **the model that actually ran** each step — the model the response that made that tool call reported, read from the calling loop's own messages, so a teammate's step is stamped with the teammate's call rather than whatever ran last in the conversation. Only when no message is there to read is the ledger (`model_call`) read: in a background run, that run's own rows (the seat's own call, else a call of the run on the seat's model, `runCallFor`), never the conversation's; in a chat turn, the conversation's newest call, for the lead's own step only. Only when no call was logged at all is the seat's pinned model shown, marked "(configured)". The batch page shows it: "Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5".

## Clients are projects

Each client is one project (today's data room): its **client voice** (structured, every line sourced), its **rules** (checked against every draft, each citing the guide or page it came from), its **notes** (the client wiki: services, audience, content inventory), its **competitors** and **site inventory**, its brand, and guideline documents filed at three stars. `onboard-client` builds it from the client's site. Every `seo_batch` and `seo_page` carries `metadata.projectId`.

**What the writer and editor read.** First the page itself: `seo_read_page` with the page returns its record (keyword, page type, location, intent, cluster, target, status, byline, meta, where the gate holds it), the editor's open findings, every note a person gave, and the full text of its SERP brief, page brief and current draft, each with its artifact id and version (16,000 characters each, `SEO_PAGE_TEXT_CAP`; a cut names the call that reads on, `part` and `offset`). It reads only this workspace's pages. Then the client: `read_project` is the bundle (`renderDataRoom`, `services/DataRoomService.ts`), in this order: the client voice block, the instructions (rules), status, wiki, the sources list (each with its id, `doc:12` or `artifact:34`) and then **the text of every ⭐⭐⭐ source**: up to 8,000 characters each and 30,000 in all (`SOURCE_TEXT_PER_SOURCE`, `SOURCE_TEXT_TOTAL`). A cut says how much was left and names the call that reads the rest (`read_project` with `source` and `offset`); a source past the total is named with its read call; a source with no text (a scan) says so. `read_project` with `find` returns passages from this project's sources only. An upload filed with `file_to_project` (`artifact_id`) is anchored to the project as a source, so it appears there and its extracted text is read. The client brand is a link to the stored copy, not 10–35k tokens of base64; `fetch_image` with the same URL and `project_id` returns the data URI when a document needs it.

**The writer and editor never read the agency.** `seo-writer` and `seo-editor` hold `harness.excludeTools: [get_brand, search_knowledge]`: the workspace brand is the agency's own, and a workspace-wide search reads every other client's material. A teammate's own exclusions now hold when a lead consults it through `task` (`teammateExcludes` in `services/agents/harness.ts`, carried to the agent runtime container as each subagent's `excludeTools`), so the strategist cannot hand them back by delegating. Guidelines are searched with `read_project` `find`.

**The client voice** (`ClientVoice` on the project, set with `update_project` `voice`): point of view, reading level, US or UK spelling, tone words, banned phrases, preferred calls to action, and claims never to make (each with the `phrases` a draft making it would use). Every line carries its `source`, a page URL or a source id. `seo_save_review` checks the current draft against the banned phrases and never-claim phrases in code (`services/seo/voiceCheck.ts`: whole words, any case, curly quotes straightened); a draft that breaks one goes back to the writer whatever the verdict, each break a finding with the line and its source. Point of view, reading level and tone stay the editor's reading.

## Onboarding a client

`onboard-client` (`templates/plugins/seo/skills/onboard-client/SKILL.md`), in order. The project is named after the client alone, in the client's own spelling, and the entity it is anchored to carries the same name (`anchorNamedAs`: an anchor with no label, or the same name cased another way, takes the project's): a project is the client in every app, so `create_project` takes an app's name off the end of a title ("Northwind Home Services — SEO" opens as "Northwind Home Services", `withoutAppSuffix`), and what SEO does for them lives in the app's batches and pages. Projects read as `PRJ-12` (the type declares `code: PRJ`; migration 0222 moves rows still on the `DR` derived from the old slug, and an old `DR-12` still resolves, since `resolveCode` accepts a type's derived code).

1. **The whole site.** `site_inventory` (`services/agents/tools/siteInventory.ts`, `libs/tools/site/inventory.ts`) reads `/sitemap.xml`, following nested sitemap indexes (Squarespace's single urlset with image entries, WordPress-style indexes of indexes), then the `Sitemap:` lines of robots.txt, and only then crawls. It keeps the site's own pages, then reads each once through `extractPageFacts`, six at a time, up to 300 pages by default (`max_pages`), and says so when the site lists more. Per page: URL, HTTP status (and a redirect), title, meta description, H1 (and how many), canonical, noindex, word count, schema.org types. It files a dated artifact on the project (folder `site-inventory`, every row linked) with a short "What needs fixing" (pages that did not load, missing titles, meta descriptions or H1s, more than one H1, duplicate titles and descriptions, noindex, canonical pointing elsewhere), and records it on the project (`siteInventory`), so the bundle links it.
2. **Competitors from Google.** 5 to 10 `serp_search` calls for the client's core services (with the city where the business is local), then `record_competitors` with every `serpResultId`. Code counts them (`libs/tools/serp/competitors.ts`): a domain ranking for two or more of the searches is a competitor; the client's own domains and directories, review sites, marketplaces and social networks (`libs/tools/serp/directories.ts`, one shared generic list) are left out. Each is recorded with the searches it ranked for, its position and its page, dated, and printed in the bundle.
3. **Guides become rules.** Each guide is filed at ⭐⭐⭐, read whole, and every do and don't line becomes a rule with `update_project` `add_rules` and `rules_source` set to the guide's id; each rule is stored citing it (`"Writing guide", artifact:34`).
4. **The pages it read are sources.** `file_to_project` with `url` and kind `page` reads the page and keeps it as a markdown artifact on the project with its URL and the date it was read (the same URL again is a new version of the same source): service, about and case-study pages at ⭐⭐, a style guide on the site at ⭐⭐⭐. The site inventory is filed as a source too, and a second inventory is a new version of the first.
5. **The brand read off the site.** `brand_lookup` with `project_id` keeps the colours, fonts and name on the project's brand (`brand.profile`, with the page and date) and fetches the logo onto it, so Brand & guidelines on the project page shows them beside the voice block. The wiki links there rather than copying them. Font names lose a built site's hashes (`Inter-b937ba1167470226`, `__Inter_a64ecd`, the `Fallback` faces; `libs/tools/brand/fontNames.ts`), on read and on display, so a profile read before still shows "Inter". A brand name that is the project's name cased another way is kept in the project's spelling.
6. **The authors.** The site's author pages become the project's `authors` (`update_project` `authors`: name, title, author page, topics, one `default`). Every planned page gets a byline in code (`bylineFor`): the author `seo_plan_batch` named for it, else the project's default. The strategist never asks for each page's author; it asks once, only when the site names no one.
7. **The voice block**, every line sourced; then the notes (services, audience, content inventory) and what is still missing, asked for in one message. A repository that is private or not connected is one line in that list: it blocks publishing, never onboarding, and the blog inventory comes from the sitemap.

Three project settings are a **person's**, set under "Publishing" on the project page (`PATCH /api/v1/projects/:id`, a signed-in person only): the gate sizes (`seoGate`), the cadence (`seoCadence`: new pages a month and an optional topic focus) and where pages publish (`publishTargets`). No agent can change them: `objects.update_meta` (the action behind `update_object`) refuses all three keys on a project whoever proposed the write (`PERSON_ONLY_FIELDS`), a token gets 403 from the project API, and `update_project` does not take them.

## The keyword plan

`seo_plan_batch` creates the batch in `plan_review` and files ONE sign-off ask (`seo-plan:<batch>:<round>`) whose context is the keyword map: keyword, page type (`location`, `service`, `blog`, `landing`, `other`), location, intent, cluster, and the target — a new page or the live URL it refreshes. The map is on the card, not behind Details: the decision sheet shows a table that heads an ask's `contextMd` (`splitContext`) and keeps the reasoning after it in Details. Each SEO ask says what its answers do (`ask.outcomes`, migration 0224: "The briefs start…", "It re-plans with your note…"), in place of the generic "Your answer is recorded …; nothing runs on its own", which any ask can do. Briefs and drafts are refused until it is approved; SERP research may go on meanwhile. **Revise** holds the batch with the person's note on it (`plan.note`); the strategist answers it with `seo_plan_batch` and `batch_id`, which replaces the proposed pages and files the next round. **Discard** takes the batch's pages out.

## New page opportunities on a cadence

A client is owed a number of new pages a month. A person sets it on the client's project, under "Publishing", next to the gate sizes: **New pages a month** (1 to 200; empty is none) and, optionally, the topic to find them **on** ("water heaters"). Stored as `seoCadence: { pagesPerMonth, focus }`, protected like `seoGate`.

Every Monday at 7:00 in the workspace's zone (`when.timezone: workspace`), the plugin's **New page opportunities** automation (`seo-opportunities`, `do: { job: seo-opportunities }`) checks each project that has a cadence. It is plain code, no model (`services/seo/cadence.ts`):

1. **What is due.** The month is owed its share by the end of the coming week, rounded up: `ceil(pagesPerMonth × min(daysInMonth, today + 6) / daysInMonth)`, the month and its days read in the workspace's zone. Eight a month is 2 by the first week of a 31-day month and all 8 by its last.
2. **What is already there.** Pages planned this month (any status but rejected), plus pages planned earlier that are still in flight (proposed through changes requested).
3. **What to propose.** Due minus what is there. **Zero: nothing is queued and nothing is said.** A project with no cadence is never read, so it is never planned for on its own.
4. **Behind pace**, it queues the strategist's background run (`seo.work_queued`, reason `opportunities`, with the project, how many pages, the cadence and the focus, once per project per day). `seo-continue` answers it as a durable mission run on `seo-batches-moving`: the strategist reads the project, re-reads the client's site (`site_inventory`) for what is new or gone, has the SERP analyst re-read Google for the client's core topics and the focus, and calls `seo_plan_batch` with `cadence: true`. That files the ordinary keyword plan sign-off card, in code, and nothing is briefed or written until a person approves it.

`seo_plan_batch` with `cadence: true` re-reads the standing itself and refuses a project with no cadence, one already on pace, and a plan with more pages than the project is short: the size is code's, never the run's word for it. The automation's run log keeps, per project, the standing it found ("2 planned or in flight against 2 due by the end of the week (8 a month): on pace") and how many pages it queued.

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

1. **Sample.** The project's sample size (3): one page of each page type first (the first of each, in planned order) until it is full, then the next pages in planned order. A batch of three blog posts samples all three; a plan with more kinds than the size samples the first kinds, and the rest come in the tranche. Nothing else is drafted, in any batch of the project, until a person has signed off on every one. A page with no type yet counts as its own kind. `seo_next_pages` says the sample's size and pages outright.
2. **Tranche.** Then the next 10, and nothing past them until every page so far is approved.
3. **Open.** Then the rest.

A page sent back with changes holds every new draft in every batch of the project until its feedback is filed; once filed, the page itself is redrafted, and the stage does not advance until it is approved. Sizes are per project: `seoGate: {sample: 3, tranche: 10}` (whole numbers 1 to 100; anything else reads as the default), set by a person.

`seo_save_draft` refuses a page the gate has not released and says why. Approval is read from a person's sign-off on the **current words**: the same draft artifact, the same round, and the artifact version and content hash the ask showed (`signoff.version`, and `signoff.hash` / `signoff.contentHash` — sha-256 of the draft's text, the hash `site.publish_page` checks — written only by `signoff.ts`) — never from a status an agent could write. An edit to the draft after it was sent for sign-off or signed off puts the page back to `in_review` with a new ask (`onSeoDraftRevised`, from the artifact save), and the gate counts it as not approved meanwhile. The gate is written back onto every batch of the project on each page write, so the SEO page shows it in one line: "3 of 40 written · waiting on your feedback on the sample of 3". Page writes merge per key under a row lock, so a sign-off landing mid-write is never lost.

## The tools

| Tool | What it does |
|---|---|
| `seo_read_page` | One page whole, the first read of every seat: its record, the editor's findings, a person's notes, and the full text of its SERP brief, brief and draft with their artifact ids and versions; a long text is cut where it says and read on with `part` and `offset`; only this workspace's pages |
| `seo_plan_batch` | A batch and its keyword plan, in writing order, for one project, each page with its page type, location, cluster, slug or existing URL; refuses a keyword or URL the project already has unless it is a refresh; files the plan's sign-off and stops. With `batch_id`, revises a plan sent back. With `cadence: true` (the weekly check's plan), refuses a project with no cadence, one on pace, or more pages than it is short |
| `seo_next_pages` | What the project's gate lets be written now, each page's next step, why the rest wait, and the client's adopted rules (`clientRulesFromSignoffs`) |
| `seo_start_writing` | Queues the released pages of a batch for the background run; the chat turn only starts it |
| `seo_save_research` | The SERP brief `serp_compare` filed (folder `seo/serp`) on a page; refuses another artifact, a brief whose synthesis is not written yet, one built on web search results, and for a location page one not read for its own city |
| `seo_save_brief` | The page brief on a page (refused until the plan is signed off; a location page's needs its "Local substance" section); records the planning model |
| `seo_save_draft` | The draft on a page with `meta_title` (at most 60, said at 55+), `meta_description` (at most 155) and `slug` (the planned one stands when left out; kebab-case, path segments allowed, unique in the project), stored as `metaTitle`, `metaDescription`, `slug` (refused past the gate, without a brief, or with meta that does not pass); withdraws an open ask from an earlier round; records the writing model |
| `seo_save_review` | The editor's verdict with `findings`; `pass` files the page's sign-off itself, `fix` withdraws any open one and queues the writer's revision (3 rounds, then the sign-off with the findings open); a draft with one of the client's banned phrases or never-claim words, or a location draft 70%+ the same as a sibling, is sent back whatever the verdict |
| `seo_record_feedback` | A note on a page, its scope (client or general) and where it was filed, checked |

Present while the `seo` plugin is on (`services/agents/tools/registry.ts`). Beside them, granted: `site_inventory` (the whole site onto the project) and `record_competitors` (with the `serp` grant).

## Sign-off and feedback

A page's sign-off shows the draft itself, rendered in place on the decision sheet with **Open the draft** (the ask's primary artifact), beside the meta and the editor's report. Any other question a seat asks — the authors for a sample, say — is answered on Needs you and goes back to that seat as a follow-up turn in its conversation, so it carries on (`services/inbox/handBack.ts`). A publish proposal reads `Publish "<page title>" → <target>`, and its Done line "Pull request opened: <link>".

Code files every sign-off, never the model: on the editor's `pass`, `seo_save_review` files core's `signoff` ask with `source_ref: seo-page:<page>:<draft>:<round>`, the draft and the page as its records, grouped under the batch on Needs you, and writes the version and hash it showed onto the page (`signoffAsk`). A redraft, a `fix` or a request for changes in words withdraws the open one. The answer comes back through `AskService.settleWaitersOn`: **Approve** approves the page, **Revise** (the answer in the person's words) records the note on the page and sends it back, **Discard** takes it out of the batch. Each draft round has its own ask, so an answer about an older draft moves nothing. After either sign-off settles, core raises `seo.work_queued` (reason `signoff`), and the plugin's `seo-continue` automation wakes the strategist on its `seo-batches-moving` mission to continue the released pages — nobody has to ask.

## Writing runs in the background, and the editor's loop is code

Drafting and review never run inside a person's chat turn (a live run hit the turn's spend ceiling mid-review): `seo_save_draft` and `seo_save_review` refuse outside a run, and in chat the strategist calls `seo_start_writing`, which queues the released pages (`seo.work_queued`, reason `write`) and says what is running. The `seo-continue` automation (`visibility: system`: plumbing, kept out of the Automations register and the app's "What you get" list unless an admin shows system automations; its page and run log stay) runs the strategist's mission as a durable mission run — its own budget on the SEO team's seats, resumable like any mission run — and progress lands on the batch and page records and, when the work was started from a conversation, in it (`tellConversation`, `services/seo/work.ts`). After each run core says where the batch stands there, read off the records (`reportSeoRun`, from `AutomationService` on a fire `seo.work_queued` started): the gate line and what waits on a sign-off, and nothing at all when nothing changed since the last line (`toldState` on the batch).

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
