# Search Engine Optimization — pages that rank, signed off early

**Search Engine Optimization** is a prebuilt app (id `seo`), the second marketing app beside [Paid Marketing](./marketing.md). An agency runs every client from one workspace: research what ranks on Google, plan pages on the strongest model, write in each client's voice and rules, get a person's feedback on the first three pages before the rest are written, route that feedback to the client or the craft, and ship pages to the client's site with sign-off.

| | |
|---|---|
| **App manifest** | `packages/core/templates/apps/seo/app.yaml` |
| **Plugin** | `seo` (`packages/core/templates/plugins/seo/`): four agents, the `seo` team, seven skills, the `seo-feedback` learning step, the `seo_batch` and `seo_page` types, two pages, trust rules. Depends on `data-rooms` (projects) and `wiki` |
| **Pages** | `/dashboard/p/seo` (every batch, its gate line, pages by status) and `/dashboard/p/seo-pages?batch=<id>` (a batch's pages) — descriptor pages over the two records |
| **Core** | `services/seo/` — `gate.ts` (the volume gate), `records.ts` (batches and pages, the gate written back on every write), `signoff.ts` (a person's sign-off onto the page), `modelThatRan.ts`, `projects.ts`; tools in `services/agents/tools/seo.ts` |
| **Research** | `serp_search` (with the local pack), `keyword_cluster` (one page per set of keywords whose top 10s share 3+ URLs), `serp_compare` (files the SERP brief in `seo/serp`, directories flagged, the pages' text and shared terms, then writes its synthesis with `brief_id`; Google's ranking only), `keyword_metrics` (volume and keyword ideas), granted with `harness.grantTools: [serp]`. See [SEO research](../guides/seo-research.md). Serper, the default provider, gives no volume or ideas: the skills carry on without them and never estimate one |
| **Publishing** | `site.publish_page` to a project's publish targets (a GitHub pull request, a Squarespace draft) |

## The seats and their models

| Agent | Does | Model |
|---|---|---|
| `seo-strategist` (lead) | Onboards clients, plans batches, writes briefs, routes feedback, publishes | Opus 5.5 |
| `serp-analyst` | What ranks and what those pages are made of: the SERP brief | Sonnet 5.5 |
| `seo-writer` | One page from its brief, in the client's voice and rules | Opus 5.5 |
| `seo-editor` | Checks every draft against the client's rules, brand, guidelines and the SERP brief before a person sees it | Sonnet 5.5 |

Each seat pins its model (`harness.modelProvider` + `harness.model`). A teammate consulted through `task` runs on its own pinned model rather than the lead's legwork model (`teammateModels`, `services/agents/harness.ts`), so the writer writes on Opus 5.5 whoever asks it. The page records **the model that actually ran** each step — read from the spend ledger (`model_call`) for the conversation or run, and marked "(configured)" when the ledger has no call yet — and the batch page shows it: "Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5".

## Clients are projects

Each client is one project (today's data room): its **rules** (checked against every draft), its **notes** (the client wiki: voice, services, audience, competitors, content inventory), its brand, and guideline documents filed at three stars. `onboard-client` builds it from the client's site. Every `seo_batch` and `seo_page` carries `metadata.projectId`.

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

Enforced in code (`services/seo/gate.ts`), never by a prompt:

1. **Sample.** A batch drafts its first 3 pages. Nothing past them is drafted until a person has signed off on every one.
2. **Tranche.** Then the next 10, and nothing past them until every page so far is approved.
3. **Open.** Then the rest of the batch.

A page sent back with changes holds every new draft in the batch until its feedback is filed (to the project or the wiki); once filed, the page itself is redrafted, and the stage does not advance until it is approved. Sizes are per project: `seoGate: {sample: 3, tranche: 10}` on the project's metadata (whole numbers 1 to 100; anything else reads as the default).

`seo_save_draft` refuses a page the gate has not released and says why. Approval is read from a person's sign-off on the **current** draft (`signoff`, written only by `signoff.ts`), never from a status an agent could write. The batch's gate is written back on every page write, so the SEO page shows it in one line: "3 of 40 written · waiting on your feedback on the first 3".

## The tools

| Tool | What it does |
|---|---|
| `seo_plan_batch` | A batch and its proposed pages, in writing order, for one project, each with its page type, location, slug or existing URL; refuses a keyword or URL the project already has unless it is a refresh |
| `seo_next_pages` | What the gate lets be written now, each page's next step, and why the rest wait |
| `seo_save_research` | The SERP brief `serp_compare` filed (folder `seo/serp`) on a page; refuses another artifact, a brief whose synthesis is not written yet, one built on web search results, and for a location page one not read for its own city |
| `seo_save_brief` | The page brief on a page (a location page's needs its "Local substance" section); records the planning model |
| `seo_save_draft` | The draft on a page (refused past the gate or without a brief); records the writing model |
| `seo_save_review` | The editor's verdict; `pass` returns the exact sign-off ask to file; a location draft 70%+ the same as a sibling is sent back whatever the verdict |
| `seo_record_feedback` | A note on a page, its scope (client or general) and where it was filed |

Present while the `seo` plugin is on (`services/agents/tools/registry.ts`).

## Sign-off and feedback

The editor files core's `signoff` ask (`file_ask`, kind `signoff`) with `source_ref: seo-page:<page>:<draft>:<round>`, grouped under the batch on Needs you. The answer comes back through `AskService.settleWaitersOn`: **Approve** approves the page, **Revise** (the answer in the person's words) records the note on the page and sends it back, **Discard** takes it out of the batch. Each draft round has its own ask, so an answer about an older draft moves nothing.

`feedback-to-wiki` then routes each note: client-specific → `update_project` (rules, or the client wiki in notes); general craft → `write_wiki_page` (the "SEO playbook" or a topical page). Both go through their normal actions and Review. `seo_record_feedback` writes where each note went onto the page. Notes on sign-offs also reach the `seo-feedback` learning step, whose adopted rules mount for the writer and the editor.

## Measures

The `seo` team is graded on **pages published** (observed, `site.publish_page` runs), **pages a person signed off** (human-confirmed, `signoff` asks) and **drafts written** (artifacts in `seo/drafts`), never on drafts alone.

## Trust

`trust.yaml` holds a direct agent write to a page (`objects.update_meta.seo_page`) and every publish (`site.publish_page`) for a person; batch fields run within bounds. The gate itself is not a trust rule: it is code.

## Installing it on Vocion Cloud

Adding Search Engine Optimization to a workspace with no folder sets the whole app up through `services/plugins/installBundle.ts`: Data rooms and the Wiki with it, the four agents (the strategist becomes the workspace lead when the workspace has only the generic one), the team, the two record types, the learning step and the trust rules (`services/seo/seo.pglite.test.ts`). Then onboard a client from their website.
