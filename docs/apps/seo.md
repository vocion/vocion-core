# Search Engine Optimization — pages that rank, signed off early

**Search Engine Optimization** is a prebuilt app (id `seo`), the second marketing app beside [Paid Marketing](./marketing.md). An agency runs every client from one workspace: research what ranks on Google, plan pages on the strongest model and get the keyword plan signed off, write in each client's voice and rules, get a person's feedback on a sample of each kind of page before the rest are written, route that feedback to the client or the craft, and ship pages to the client's site with sign-off.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/seo/app.yaml` |
| **Plugin** | `seo` (`packages/core/templates/plugins/seo/`): four agents, the `seo` team, nine skills, five playbooks (the agency's way of working), the `seo-feedback` learning step, the `seo_strategy`, `seo_audit`, `seo_keyword`, `seo_prompt`, `seo_batch` and `seo_page` types, six pages (Strategy, Audits, Keywords, Prompts, Batches, Pages), trust rules, four workflows (`seo-batch`, `seo-page`, `seo-plan`, `seo-opportunities`), the `seo-batches-moving` mission ("Each client grows in search") and one automation, `seo-opportunities` ("New page opportunities", weekly). Depends on `data-rooms` (projects) and `wiki` |
| **Pages** | `/dashboard/p/seo` (every batch, its gate line, pages by status) and `/dashboard/p/seo-pages?batch=<id>` (a batch's pages) — descriptor pages over the two records |
| **Core** | `services/seo/` — `gate.ts` (the volume gate, per project), `records.ts` (batches and pages, the gate written back on every write, per-key merges under a row lock), `signoff.ts` (the plan and page sign-offs, filed and heard in code), `cadence.ts` (pages a month, and the weekly check), `meta.ts` (meta title, description and slug), `modelThatRan.ts`, `projects.ts`; tools in `services/agents/tools/seo.ts` |
| **Research** | `serp_search` (with the local pack), `keyword_cluster` (one page per set of keywords whose top 10s share 3+ URLs), `serp_compare` (files the SERP brief in `seo/serp`, directories flagged, the pages' text and shared terms, then writes its synthesis with `brief_id`; Google's ranking only), `keyword_metrics` (volume and its trend, KD, CPC, intent, AI Overview, keyword ideas; Ahrefs when connected, else DataForSEO), `search_console_queries` / `search_console_pages` (what the client already ranks for, free) and `record_competitors`, granted with `harness.grantTools: [serp]`; `site_inventory`, granted by name. See [SEO research](../guides/seo-research.md) and [SEO data](../guides/seo-data.md). Serper, the default provider, gives no volume or ideas: the skills carry on without them and never estimate one |
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

## The SEO profile: what kind of client, and what they want

Clients differ in what search should do for them: a local services client needs its Google Business Profile and a page per place it serves, a B2B SaaS client needs use-case, comparison and integration pages, and a client who wants to be named in AI answers needs tracked prompts and pages worth citing. The project's **SEO profile** (`meta.seoProfile`, `services/seo/profile.ts`) says which: client type (`b2b_saas`, `local_services`, `ecommerce`, `other`), goals ranked (`organic_leads`, `google_business_profile`, `ai_answers`, `rankings`, `other`), industry, offering, audience, locations, language, tone, competitor domains, website, the publish target its pages go to by default, and links to its guidelines (the project's Instructions, Wiki and ⭐⭐⭐ guideline documents; the free-form voice and rules stay there).

- **Onboarding drafts it on one card.** `seo_propose_profile` pre-fills it in code from the client's home page (its language tag, meta description, schema types and the places its schema names), the site inventory's paths (`/pricing` and `/integrations` read as B2B SaaS, `/products/` and `/cart` as ecommerce, LocalBusiness schema as local services; one path is not a pattern), the competitors Google ranked and the project's first publish target, and lays over it what the agent read (industry, offering, audience, tone), each value with where it came from. It files one `seo.save_profile` card: the person edits the text and saves it, or declines. Every run waits for a person (`approvalRequired`); Undo puts back the profile that was there.
- **A person edits it on the project page** (the "SEO profile" section, with the SEO app on), and the project API takes it only from a signed-in person. `seoProfile` is in `PERSON_ONLY_FIELDS`, so `update_object` refuses it.
- **It decides what comes first** (`seoPriorities`). The bundle prints it right after the voice, with "What comes first for this client" ordered by the goals as ranked, then the client type, and the page types to weight a plan toward. The project page shows the same list under the profile.
- **It picks the playbooks to lead with.** `seoPriorities` chooses which of the agency's playbooks come first for this client (the brief and on-page checklist always, the doorway playbook for a local services client or one that wants its Google Business Profile, sourcing and claims for one that wants to be named in AI answers, internal linking always). The bundle names them with the path each seat reads (`Playbooks to lead with for this client: … (/playbooks/<slug>/SKILL.md)`), the project page links each one under "Playbooks we lead with", and the strategy document lists them (`playbookLinks`).

## The agency's playbooks

Three layers shape every page, and each has one home:

| Layer | What it holds | Where it lives | Who changes it |
|---|---|---|---|
| **Project rules** | What is true of one client: their voice, banned phrases, claims they never make, their services | The client's project (`update_project`) | The strategist, from onboarding and client notes |
| **Playbooks** | How the agency works on every client: how it briefs, sources, links and checks a page | The workspace (`playbooks/<slug>/SKILL.md`), mounted at `/playbooks/<slug>/` | A person, in place, or a feedback note a person approves as a diff |
| **Learnings** | One-line rules adopted from sign-offs | The `seo-feedback` learning step, `/learnings/seo-feedback.md` | A person adopting a candidate at `/dashboard/learnings` |

Where they disagree the client's rules win, then the adopted learnings, then the playbooks, then the skills (the procedure: which tool, in which order).

The plugin ships five (`templates/plugins/seo/playbooks/`):

| Playbook | What it settles | Read by |
|---|---|---|
| `how-we-brief-a-page` | Search intent from what ranks, the gap the page owns, the outline, the entities to name, internal links, FAQ, schema | strategist |
| `location-pages-without-doorways` | When a location page earns its place, local substance, NAP, the truth about the service area, the similarity check | strategist, writer, editor |
| `sourcing-and-claims` | Every number sourced and dated, no invented statistics, client proof only as worded, E-E-A-T: a real author and first-hand experience | strategist, writer, editor |
| `on-page-checklist` | Title and meta lengths, one H1, headings, alt text, canonical and indexability, links, schema, readability | strategist, writer, editor |
| `internal-linking` | Hubs, anchors, no orphan pages, links to the service pages | strategist, writer, editor |

Each seat names its playbooks in its agent YAML (`playbooks:`), so they mount on every turn; a teammate the strategist consults through `task` reads its own at the same `/playbooks/` path (`teammatePlaybooks`, `services/agents/harness.ts`). The editor reviews every draft against `on-page-checklist` and `sourcing-and-claims` (a failed item is a finding that quotes the line); `review-page`, `write-page` and `page-brief` name the playbooks they read.

**Applied once, then the workspace's.** In a workspace with no folder (every Vocion Cloud workspace), installing the app writes each playbook as the workspace's own copy: its `source` mirror artifact, the row a folder workspace edits through (`services/playbooks/owned.ts`). From then on the mount, `read_playbook` and the skills page read that copy. A person edits it in place on `/dashboard/skills/<slug>` (versions, restore), and an agent's `write_playbook` lands on it once a person approves the diff. When core ships new templates, an upgrade (`services/plugins/upgradeBundles.ts`) moves a copy nobody touched to them and keeps a copy a person changed, listed as kept on the version row (`AppBundleRecord.playbooks` holds a hash of what the bundle last left in each copy). A workspace applied from a folder overrides a playbook with a same-slug file under `playbooks/`.

**Visible.** The app's page lists the playbooks under "What you get", and the "How SEO is doing" panel on the SEO page links each one ("yours to edit" where the workspace keeps its own copies).

## Onboarding a client

`onboard-client` (`templates/plugins/seo/skills/onboard-client/SKILL.md`), in order. The project is named after the client alone, in the client's own spelling, and the entity it is anchored to carries the same name (`anchorNamedAs`: an anchor with no label, or the same name cased another way, takes the project's): a project is the client in every app, so `create_project` takes an app's name off the end of a title ("Northwind Home Services — SEO" opens as "Northwind Home Services", `withoutAppSuffix`), and what SEO does for them lives in the app's batches and pages. Projects read as `PRJ-12` (the type declares `code: PRJ`; migration 0222 moves rows still on the `DR` derived from the old slug, and an old `DR-12` still resolves, since `resolveCode` accepts a type's derived code).

1. **The whole site.** `site_inventory` (`services/agents/tools/siteInventory.ts`, `libs/tools/site/inventory.ts`) reads `/sitemap.xml`, following nested sitemap indexes (Squarespace's single urlset with image entries, WordPress-style indexes of indexes), then the `Sitemap:` lines of robots.txt, and only then crawls. It keeps the site's own pages, then reads each once through `extractPageFacts`, six at a time, up to 300 pages by default (`max_pages`), and says so when the site lists more. Per page: URL, HTTP status (and a redirect), title, meta description, H1 (and how many), canonical, noindex, word count, schema.org types. It files a dated artifact on the project (folder `site-inventory`, every row linked) with a short "What needs fixing" (pages that did not load, missing titles, meta descriptions or H1s, more than one H1, duplicate titles and descriptions, noindex, canonical pointing elsewhere), and records it on the project (`siteInventory`), so the bundle links it.
2. **Competitors from Google.** 5 to 10 `serp_search` calls for the client's core services (with the city where the business is local), then `record_competitors` with every `serpResultId`. Code counts them (`libs/tools/serp/competitors.ts`): a domain ranking for two or more of the searches is a competitor; the client's own domains and directories, review sites, marketplaces and social networks (`libs/tools/serp/directories.ts`, one shared generic list) are left out. Each is recorded with the searches it ranked for, its position and its page, dated, and printed in the bundle.
3. **Guides become rules.** Each guide is filed at ⭐⭐⭐, read whole, and every do and don't line becomes a rule with `update_project` `add_rules` and `rules_source` set to the guide's id; each rule is stored citing it (`"Writing guide", artifact:34`).
4. **The pages it read are sources.** `file_to_project` with `url` and kind `page` reads the page and keeps it as a markdown artifact on the project with its URL and the date it was read (the same URL again is a new version of the same source): service, about and case-study pages at ⭐⭐, a style guide on the site at ⭐⭐⭐. The site inventory is filed as a source too, and a second inventory is a new version of the first.
5. **The brand read off the site.** `brand_lookup` with `project_id` keeps the colours, fonts and name on the project's brand (`brand.profile`, with the page and date) and fetches the logo onto it, so Brand & guidelines on the project page shows them beside the voice block. The wiki links there rather than copying them. Font names lose a built site's hashes (`Inter-b937ba1167470226`, `__Inter_a64ecd`, the `Fallback` faces; `libs/tools/brand/fontNames.ts`), on read and on display, so a profile read before still shows "Inter". A brand name that is the project's name cased another way is kept in the project's spelling.
6. **The authors.** The site's author pages become the project's `authors` (`update_project` `authors`: name, title, author page, topics, one `default`). Every planned page gets a byline in code (`bylineFor`): the author `seo_plan_batch` named for it, else the project's default. The strategist never asks for each page's author; it asks once, only when the site names no one.
7. **The voice block**, every line sourced; then the notes (services, audience, content inventory) and what is still missing, asked for in one message. A repository that is private or not connected is one line in that list: it blocks publishing, never onboarding, and the blog inventory comes from the sitemap.

Three project settings are a **person's**, set under "Publishing" on the project page (the SEO profile is a fourth, above) (`PATCH /api/v1/projects/:id`, a signed-in person only): the gate sizes (`seoGate`), the cadence (`seoCadence`: new pages a month and an optional topic focus) and where pages publish (`publishTargets`). No agent can change them: `objects.update_meta` (the action behind `update_object`) refuses all three keys on a project whoever proposed the write (`PERSON_ONLY_FIELDS`), a token gets 403 from the project API, and `update_project` does not take them.

## Keywords

Keyword research is kept, not left in the chat it was done in. The **Keywords** page (first in the SEO nav, then Batches, then Pages) lists every keyword researched for every client, one row per keyword per project (`seo_keyword`, `services/seo/keywords.ts`), with its intent, monthly volume, Google Ads competition, the client's own position, its status, its batch, and the date it was last checked. Filter by project and by status; each row links its page and the page's SERP brief, which stays on the page.

- **Kept in code by the research tools.** `serp_search`, `keyword_cluster`, `keyword_metrics` and `serp_compare` write what they read into the project's register as part of the call (`services/agents/tools/keywordRegister.ts`): the top ten results with the date they were read and where the client's domains rank, the volume, competition and cost per click with their date, the cluster head with its date. The keyword as it is compared (case, spacing and punctuation gone) and the project are the key, held unique in the database, so a second read refreshes the row and never adds one. The project is the one the call names (`project_id`), else the project the page in view is about, else the one the conversation or background run last named; with none, nothing is kept and the result says to name it. Another engine's order (no SERP provider) is not kept as Google's ranking.
- **It follows its page.** Every write to a project's pages brings its register in step (`syncProjectKeywords`, from `refreshSeoProject`): each planned keyword has its row, linked to its batch, page and SERP brief. Status reads `idea` → `in_batch` → `published` → `ranking` (a Google read shows the client's site) and back to `published` when it no longer does; a page discarded on its sign-off drops its keyword; a revised plan that leaves a keyword out makes it an idea again.
- **Planned from ticked rows.** Tick keywords on the page and **Plan a batch from these** starts a chat with the strategist holding them (the page's `selectionPrompts`). It plans with `seo_plan_batch` and their `keyword_ids`: one page per row in the order ticked, or the pages it gives (to set types and locations) as long as every ticked keyword is among them. A topic plan writes its keywords into the register the same way.
- **The why, dated.** `seo_update_keywords` keeps why a keyword is worth a page, or why it was dropped, with the date and who said it; a keyword whose page is in a batch is not dropped there (its page is discarded on its sign-off). `seo_list_keywords` reads a project's register.
- **Where it came from.** `chat`, `weekly` (the weekly opportunities run: its research and its `cadence` plan) or `imported`.

## Strategy: each client's goal

"Structured planning and execution for each client's SEO strategy." A strategy is a **Goal** (`docs/guides/goals.md`) the person owns: `seo_draft_strategy` composes it from the client's profile, latest audit, batches, prompts and keywords (`services/seo/strategy.ts`): the title from the client's first goal ("Tally Books named in AI answers for agency invoicing in Q1 2027"), and 3–7 milestones each linked to the record whose own status completes it: the latest audit (its row reads `resolved` once no high finding is open), a batch (`published` once every page it keeps is live), a prompt (`complete` once an answer names or cites the client). Work not started yet is a milestone with no link. It writes the strategy document on the project (an artifact: the goal, who the client is, what comes first, where things stand, the milestones) and files the goal as the usual `goal.create` Decision card, which the person approves or edits. The `seo_strategy` record (one per project) is the Strategy page's row: the goal, its status and progress, its milestones and the document, read again whenever the SEO work moves (`refreshStrategy`, from the page writes, audits and prompt saves). The project page shows it under the SEO profile, with the latest audit.

The strategist's standing mission is the growth outcome, not the activity: `seo-batches-moving`, renamed **Each client grows in search**, is judged on pages live against each client's pages a month, published keywords reaching the first page, being named on more tracked prompts, strategy milestones completing and the audit's high findings fixed.

## Audits: what is wrong, and what to fix first

"Audit and report, then recommended next steps." `seo_run_audit` (`services/agents/tools/seoAudit.ts`) reads the client's whole site again (the site inventory, a new version of the same artifact), the home page's Organization schema, robots.txt and Google's first page for the client's name, and the checks in `services/seo/audit.ts` turn what was read into findings:

| Category | Checks |
|---|---|
| Technical | pages that did not load, noindex (high on the home page), canonicals pointing elsewhere, no sitemap, robots.txt shutting every crawler out, not first on Google for its own name |
| Content | missing titles, meta descriptions and H1s, more than one H1, the same title, H1 or meta description on several pages, thin pages (under 300 words) |
| AI visibility | no Organization schema on the home page, one with no description or one that shares no words with the profile's offering (it should say what the business is now), no sameAs profiles, AI answer engines' crawlers (GPTBot, ClaudeBot, PerplexityBot, …) disallowed |
| Local and Google Business Profile | for a local client or a GBP goal: no LocalBusiness schema, no phone or address in it, a place on the profile with no page naming it |

A check whose read failed (no SERP provider, the home page did not answer) makes no finding, and the tool says it did not run. Each run is its own **`seo_audit`** record (`services/seo/audits.ts`, unique per project and run through the external key `seo-audit`), holding its findings: category, severity, title, evidence, the page or pages (25 listed at most), `checkedAt`, and status `open`, `fixed` or `dismissed` with when, who and why. A finding's key is its check and page, so a later run carries a dismissal forward and marks fixed, on the run that found it, whatever it no longer finds (`carryForward`). Statuses move only as `nextFindingStatus` allows: a fixed finding is reopened before it is dismissed, and the other way round.

The run files a **shareable report** (a markdown artifact on the audit's record, folder `seo/audits`): the counts, the **recommended next steps** (open findings, high first, then what the client's profile puts first: local findings for a local client, AI-visibility findings when AI answers is a goal), and every finding with its evidence, pages, status and **Fix it**. Fix it opens a chat that calls `seo_update_findings`: `plan_page` plans a page in one batch with its sign-off (a missing location page suggests its own keyword), `make_task` files an open item on the project; either is linked on the finding, which stays open until a later run no longer finds it or a person marks it fixed. `dismiss` needs a reason.

The **Audits** page lists every run by client (open, high, by category, checked), with the report one click away, and "Fix these" on ticked rows. The project page shows the latest audit's headline and next steps. A new client's first run is onboard, audit, report, next steps (`audit-site`), and the SEO chat offers "Audit a client's site".

## Prompts: is the client named in AI answers?

A client whose profile ranks "Named in AI answers" needs the questions its buyers ask AI assistants tracked, and pages worth citing for them. The **Prompts register** (`seo_prompt`, `services/seo/prompts.ts`) keeps one row per prompt per client project, keyed by the project and the prompt as compared (`promptKey`: case, quotes, spacing and closing punctuation ignored), held unique through the external key `seo-prompt`. Each row has the prompt, its group (`category`, `shortlist`, `problem`, `comparison`, `brand`), intent, the platforms tracked (ChatGPT, AI Overviews, AI Mode, Perplexity, Gemini, Copilot, Claude), whether the client is **mentioned** or **cited** and the pages cited, the **competitors named**, `checkedAt` and what it was checked with, its source (`agent` or `imported`), status (`tracked` or `dropped`) and a dated why.

- **Saved in code, never only in an artifact.** `seo_save_prompts` keeps what the strategist proposes in the same turn (`ai-prompts` skill); saving again refreshes the row, adds platforms and never lets an older check overwrite a newer one. `seo_list_prompts` reads the register first, so nothing is proposed twice.
- **Ahrefs Brand Radar in.** A CSV export dropped in chat goes in with `seo_import_prompts` (the file's artifact id). Columns are found by their header (prompt or query, platform, mentioned, cited, competitors, date, group, intent), rows of one prompt across platforms merge (a mention anywhere counts), an empty cell is "not checked", never "no", and the answer names each column it read and each it left out.
- **Brand Radar out.** `seo_export_prompts` files a CSV (prompt first, which Brand Radar's custom prompts take, then group, intent, platforms, mentioned, cited, competitors, last checked); reading it back gives the same prompts.

The **Prompts** page lists them by client with Cited / Mentioned / Not mentioned counts, and its buttons start the import and export in chat. Ticked prompts → "Plan pages for these".

## The keyword plan

`seo_plan_batch` creates the batch in `plan_review` and files ONE sign-off ask (`seo-plan:<batch>:<round>`) whose context is the keyword map: keyword, page type (`location`, `service`, `blog`, `landing`, `other`), location, intent, cluster, and the target — a new page or the live URL it refreshes. The map is on the card, not behind Details: the decision sheet shows a table that heads an ask's `contextMd` (`splitContext`) and keeps the reasoning after it in Details. Each SEO ask says what its answers do (`ask.outcomes`, migration 0224: "The briefs start…", "It re-plans with your note…"), in place of the generic "Your answer is recorded …; nothing runs on its own", which any ask can do. Briefs and drafts are refused until it is approved; SERP research may go on meanwhile. **Revise** holds the batch with the person's note on it (`plan.note`); the strategist answers it with `seo_plan_batch` and `batch_id`, which replaces the proposed pages and files the next round. **Discard** takes the batch's pages out.

## New page opportunities on a cadence

A client is owed a number of new pages a month. A person sets it on the client's project, under "Publishing", next to the gate sizes: **New pages a month** (1 to 200; empty is none) and, optionally, the topic to find them **on** ("water heaters"). Stored as `seoCadence: { pagesPerMonth, focus }`, protected like `seoGate`.

Every Monday at 7:00 in the workspace's zone (`when.timezone: workspace`), the plugin's **New page opportunities** automation (`seo-opportunities`, `do: { job: seo-opportunities }`) checks each project that has a cadence. It is plain code, no model (`services/seo/cadence.ts`):

1. **What is due.** The month is owed its share by the end of the coming week, rounded up: `ceil(pagesPerMonth × min(daysInMonth, today + 6) / daysInMonth)`, the month and its days read in the workspace's zone. Eight a month is 2 by the first week of a 31-day month and all 8 by its last.
2. **What is already there.** Pages planned this month (any status but rejected), plus pages planned earlier that are still in flight (proposed through changes requested).
3. **What to propose.** Due minus what is there. **Zero: nothing is queued and nothing is said.** A project with no cadence is never read, so it is never planned for on its own.
4. **Behind pace**, it starts the `seo-opportunities` workflow (with the project, how many pages, the standing and the focus): the strategist reads the project, re-reads the client's site (`site_inventory`) for what is new or gone, has the SERP analyst re-read Google for the client's core topics and the focus, and calls `seo_plan_batch` with `cadence: true`. That files the ordinary keyword plan sign-off card, in code, and nothing is briefed or written until a person approves it.

What that run researches and plans enters the client's Keywords register as `weekly`.

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
| `seo_start_writing` | Starts one `seo-page` workflow run per page the gate released (through `seo-batch`); the chat turn only starts them |
| `seo_save_research` | The SERP brief `serp_compare` filed (folder `seo/serp`) on a page; refuses another artifact, a brief whose synthesis is not written yet, one built on web search results, and for a location page one not read for its own city |
| `seo_save_brief` | The page brief on a page (refused until the plan is signed off; a location page's needs its "Local substance" section); records the planning model |
| `seo_save_draft` | The draft on a page with `meta_title` (at most 60, said at 55+), `meta_description` (at most 155) and `slug` (the planned one stands when left out; kebab-case, path segments allowed, unique in the project), stored as `metaTitle`, `metaDescription`, `slug` (refused past the gate, without a brief, or with meta that does not pass); withdraws an open ask from an earlier round; records the writing model |
| `seo_save_review` | The editor's verdict with `findings`; `pass` files the page's sign-off itself, `fix` withdraws any open one and queues the writer's revision (3 rounds, then the sign-off with the findings open); a draft with one of the client's banned phrases or never-claim words, or a location draft 70%+ the same as a sibling, is sent back whatever the verdict |
| `seo_record_feedback` | A note on a page, its scope (client or general) and where it was filed, checked: the page's own project, a proposed edit to a playbook (`playbook:<slug>` with the whole new SKILL.md), or a candidate rule |

Present while the `seo` plugin is on (`services/agents/tools/registry.ts`). Beside them, granted: `site_inventory` (the whole site onto the project) and `record_competitors` (with the `serp` grant).

## Sign-off and feedback

A page's sign-off shows the draft itself, rendered in place on the decision sheet with **Open the draft** (the ask's primary artifact), beside the meta and the editor's report. Any other question a seat asks — the authors for a sample, say — is answered on Needs you and goes back to that seat as a follow-up turn in its conversation, so it carries on (`services/inbox/handBack.ts`). A publish proposal reads `Publish "<page title>" → <target>`, and its Done line "Pull request opened: <link>".

**A page is approved once, on its workflow run.** Each page's `seo-page` run ends at its sign-off (the run's `approve` step: one Decision on Needs you, the editor's last review laid out, links to the draft and the page). Approving it runs `seo.record_signoff` (`libs/actions/seo-record-signoff.ts`), which writes the person's sign-off onto the page bound to the words they were shown (the version and hash `seo_save_review` recorded when the draft passed, `signoffAsk` with `askId: 0`) and refuses a draft that changed since. Then `site.publish_page` runs on the SEO plugin's trust rule with no second card: it opens an unmerged pull request, or saves a Squarespace draft that is not live, and its Undo closes the pull request. It holds anything else for a person (`holdForPerson`: a page with no person's sign-off on its current words, or a page the SEO app does not track). Going live on Squarespace (`site.publish_live`) is always its own card, never "Always allow". Rejecting the sign-off is sending the page back: the note goes on the page (`changes_requested`) and a redraft run starts whose first step files the note (`onSeoWorkflowAskSettled`, `services/seo/signoff.ts`). A sign-off also releases the next pages the gate allows, each into its own run.

Pages and plans signed off on the older cards (`source_ref: seo-page:…` and `seo-plan:…`) keep working: the answer moves the page or the batch as before (`onSeoAskSettled`), and the follow-up starts the matching workflow. A keyword plan is still its own sign-off; a plan sent back is revised by the `seo-plan` workflow.

## One workflow run per page, and the editor's loop is the run's

Writing is a fixed procedure, so it is a workflow (ADR 0011), visible step by step on its run page and in running work ("Boiler repair · page 2 of 3: boiler servicing"), not a hidden automation re-reading a mission prompt. The hand-offs are code (`services/seo/pipeline.ts`): `seo_start_writing`, an approved plan or a sign-off that releases more pages starts `seo-batch`, which starts one `seo-page` run per page the gate released (`workflow.start`). The gate stays code: only released pages get a run, a page already in a running or waiting run gets no second one, and `seo_save_draft` still refuses a page the gate has not released. `seo-page`: a redraft files the person's note first; research and the brief run when the page lacks them; the writer drafts; the editor reviews in a bounded repeat (at most 3 rounds; the writer revises between them); the person signs off; the sign-off is recorded; the page is published as a draft; a Squarespace page goes live on its own card. Drafting and review never run inside a person's chat turn: `seo_save_draft` and `seo_save_review` refuse outside a run (a workflow step or a mission run). The plugin's workflows join the workspace's as its agents and missions do (`libs/workspace/loader.ts`); a workspace workflow of the same slug wins. The hidden `seo-continue` automation is retired; a workspace whose SEO app is not upgraded yet has no pipeline workflows, and its hand-offs still raise `seo.work_queued` until it is.

The editor gives `findings` (a list of `{ issue, location, fix }`, each field kept to 600 characters) and notes of any length: a review longer than the page keeps, or one with findings, is stored whole as an artifact in `seo/reviews` linked from the page (`review.notesArtifactId`), so a review is never lost to a limit. Inside a run, a `fix` sends the draft back to the writer in the run's repeat, counted on the page (`editorRounds`); after 3 rounds the run goes to the sign-off anyway with the open findings shown, and the person decides. The editor ends its step with the verdict the tool recorded, which the repeat reads. Only a pass or exhausted rounds reaches a person; a person's answer starts the count again.

`feedback-to-wiki` then routes each note to one place, and `seo_record_feedback` checks the filing before the gate counts it:

- **client** → `update_project` with `project_id` set to the page's project (SEO seats must name it; "the project on screen" is refused). `update_project` writes directly: there is no Review step. Then `filed_to: project:<that id>` with `filed_text`, which must be on that project's rules or notes; another project's id is refused. A client's note never changes a playbook: `filed_to: playbook:…` with scope `client` is refused.
- **general, and it changes how we work** → a playbook edit. The strategist reads the matching playbook (`read_playbook`), makes the smallest edit that says it, and calls `seo_record_feedback` with `filed_to: playbook:<slug>`, `filed_text` (the words added, as they read in the new text) and `playbook_md` (the whole SKILL.md after the edit). The tool checks the words are in the new text and not already in the playbook, and proposes it through `workspace.write_playbook`: the same card with the diff that any playbook change gets, approved in Review, reversible with Undo. One change per playbook waits at a time; a second note on the same playbook must build on the waiting one, or it is refused with that change's text. The run is recorded on the note (`filedRef.actionRunId`).
- **general, and it is one line** → `filed_to: learning:seo-feedback` with the rule as `filed_text`. The tool files it as a learning candidate (`sourceRef` names the page and project) for a person to adopt at /dashboard/learnings; adopted rules mount for the writer and the editor. A client's note filed this way is scoped to its project (`data_room/<id>`) and, once adopted, reaches only that project's pages (through `seo_next_pages`).

**A rule or a playbook edit?** A note becomes a rule when it is one sentence a draft can be checked against and no playbook section is about it ("never open with a question"). It becomes a playbook edit when it adds or corrects a step, a check, a threshold or a method a playbook covers ("a location page names where the crew comes from", "two links in to every new page"), and whenever it narrows or contradicts what a playbook says: a rule that argues with a playbook leaves two places to read.

A candidate that was rejected, a playbook change a person left as it was (or that failed or was undone), a note filed to another client, or words that are not on the project do not count as filed; a waiting playbook change counts while its text still carries the note's words. SEO sign-offs skip the generic learning-from-decision path, so a note is never proposed twice or filed for every client. There is no SEO wiki page: the playbooks and the learning step are where craft is read from.

## Measures

The `seo` team is graded on **pages published** (observed, `site.publish_page` runs), **pages a person signed off** (human-confirmed, `signoff` asks answered Approve — a Revise is not a sign-off) and **drafts written** (artifacts in `seo/drafts`), never on drafts alone.

## Trust

`trust.yaml` holds a direct agent write to a page (`objects.update_meta.seo_page`) and every publish (`site.publish_page`) for a person; batch fields run within bounds. The gate itself is not a trust rule: it is code, and so are the person-only project settings.

## Installing it on Vocion Cloud

Adding Search Engine Optimization to a workspace with no folder sets the whole app up through `services/plugins/installBundle.ts`: Data rooms and the Wiki with it, the four agents (the strategist becomes the workspace lead when the workspace has only the generic one), the team, the two record types, the five playbooks as the workspace's own copies, the learning step and the trust rules (`services/seo/seo.pglite.test.ts`, `services/seo/playbooks.pglite.test.ts`). Then onboard a client from their website.
