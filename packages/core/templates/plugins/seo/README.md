# SEO pages

SEO pages for every client from one workspace: research what ranks on Google,
plan pages on the strongest model, write in each client's voice and rules, get
feedback on the first pages before the rest are written, and ship pages to the
client's site with a person's sign-off. The **Search Engine Optimization** app.

## What it adds

- **Four seats on one team (`seo`)**: the SEO strategist (lead; plans batches
  and writes briefs on Opus 5.5), the SERP analyst (research legwork on
  Sonnet 5.5, granted the `serp` tools), the SEO writer (Opus 5.5) and the
  SEO editor (Sonnet 5.5), who checks every draft before a person sees it.
- **Three records**, each carrying `projectId`: `seo_batch` (a set of pages for
  one client and topic, with its gate), `seo_page` (one keyword, its page
  type, location and target URL, its status, the SERP brief, brief and draft
  artifacts, the model that ran each
  step, every feedback note with where it was filed, and the pull request and
  live URL once published) and `seo_keyword` (the Keywords register: every
  keyword researched for a client, once, kept by the research tools in code
  with its volume, competition, cluster, top results and the client's
  position, each with the date it was read; it follows its page from idea to
  in a batch, published and ranking). The Keywords page lists them first in
  the SEO nav; tick rows and "Plan a batch from these" asks the strategist.
- **An SEO profile on each client's project**: client type (B2B SaaS, local
  services, ecommerce), goals ranked, industry, offering, audience, places,
  language, tone, competitors, website, publish target and links to its
  guidelines (`services/seo/profile.ts`). Onboarding pre-fills it from the
  site and puts it on one card a person saves (`seo_propose_profile`,
  `seo.save_profile`); a person edits it on the project page. The client
  type and goals decide what comes first, printed in the bundle the seats
  read.
- **Audits** (`seo_audit`, one record per run per client): `seo_run_audit`
  reads the whole site, the home page's Organization schema, robots.txt and
  Google's results for the client's name, and checks them in code
  (technical, content, AI visibility, local and Google Business Profile).
  Each finding has its severity, evidence, page, date and status (open,
  fixed, dismissed); a dismissal carries to the next run, and what a later
  run no longer finds is marked fixed. A shareable report artifact leads
  with the recommended next steps, in the order the client's profile puts
  first; a finding's Fix it (`seo_update_findings`) plans a page in a batch
  or makes a task on the project and links it. The Audits page lists every
  run; the project page shows the latest.
- **Prompts** (`seo_prompt`, one row per AI-answer prompt per client): the
  questions buyers ask AI assistants, by group (category, shortlist,
  problem, comparison, brand), the platforms tracked, and whether the client
  is mentioned or cited and which competitors are, with when that was
  checked. The strategist saves the prompts it proposes in code
  (`seo_save_prompts`); an Ahrefs Brand Radar CSV export dropped in chat is
  imported (`seo_import_prompts`), and `seo_export_prompts` writes one back.
- **A signed-off keyword plan**: `seo_plan_batch` files one sign-off showing
  the keyword map (keyword, page type, location, intent, cluster, new page or
  refresh). Nothing is briefed or drafted until a person approves it.
- **The volume gate**, enforced in code and per client project: a sample
  first (the project's sample size, 3 by default: one page of each page
  type first, then the next in planned order), nothing more in any of the
  project's batches until a person signed off on every one; then a tranche
  of 10; then the rest. A page sent back with changes holds new drafts until
  its feedback is verifiably filed. A sign-off is bound to the draft's words:
  an edit afterwards puts the page back to review with a new ask.
- **One workflow run per page** (`workflows/`, started in code by
  `services/seo/pipeline.ts`): writing never runs in a chat turn;
  `seo_start_writing`, an approved plan or a sign-off that releases more
  pages starts `seo-batch`, which starts one `seo-page` run per page the
  gate released: research, brief, draft, the editor's review (at most three
  rounds, then the person decides with the findings open), the person's
  ONE sign-off (the run's approve step), the sign-off recorded on the page
  in code bound to its words (`seo.record_signoff`), and `site.publish_page`
  as an unmerged pull request or a Squarespace draft, on the trust rule with
  no second card. Squarespace's going live (`site.publish_live`) is always
  its own card. A page sent back at sign-off gets a redraft run that files
  the note first; a plan sent back is revised by `seo-plan`. The hidden
  `seo-continue` automation is retired; a workspace not yet upgraded keeps
  the old event until it is.
- **New page opportunities on a cadence**: a person sets pages a month (and
  an optional topic focus) on a client's project. Every Monday in the
  workspace's zone, `seo-opportunities` counts what is planned or in flight
  this month and, only for a project behind pace, has the strategist re-read
  Google and the client's site and propose just the pages it is short as a
  keyword plan for sign-off. On pace, nothing is proposed and nothing is
  said; no cadence, no plan.
- **Local search, in code**: a location page is researched on its own city's
  Google results, its brief carries the client's local substance, and its
  draft fails review when it is a sibling location page with the city
  swapped (70% or more the same). A plan that targets a keyword or URL the
  project already has is refused unless it is a refresh.
- **Skills**: `onboard-client`, `audit-site`, `ai-prompts`, `serp-research`, `page-brief`, `write-page`,
  `review-page`, `feedback-to-wiki`, `publish-page`.
- **Playbooks, the agency's way of working**: `how-we-brief-a-page`,
  `location-pages-without-doorways`, `sourcing-and-claims`,
  `on-page-checklist`, `internal-linking`. The strategist, the writer and the
  editor name them (`playbooks:`), and the editor checks every draft against
  the on-page checklist and the sourcing rules. Installed into a workspace
  with no folder, they are applied once as the workspace's own copies, edited
  in place, and an upgrade keeps a copy a person changed.
- **Feedback that edits the playbooks**: a craft note that changes how the
  agency works becomes a proposed edit to the matching playbook, a diff a
  person approves in Review. A client's note goes to its project, never a
  playbook.
- **The learning step `seo-feedback`**: one-line craft rules from sign-offs
  become candidate rules, tagged with their project; adopted ones mount for
  the writer and the editor. A client's own candidate, once adopted, reaches
  only that client's pages.
- **Pages**: SEO (every batch with its gate line and pages by status) and SEO
  pages (a batch's pages with keyword, type, location, target URL, status,
  models and links).

It turns on the `data-rooms` plugin (Projects kept current) and the Wiki with it. Projects themselves are core, in every app, so turning SEO on adds the SEO app and no other.

## Customising

- Gate sizes, cadence and publish targets: a person sets them under
  "Publishing" on the client's project page (for example a sample of 5,
  then 20; 8 new pages a month on water heaters). A missing or invalid gate
  falls back to the default; a project with no cadence gets no plan on its
  own. No agent can change any of them: `update_object` refuses `seoGate`,
  `seoCadence` and `publishTargets`, and the project API takes them only
  from a signed-in person.
- The pipeline's workflows are the workspace's to change: a
  `workflows/<slug>/workflow.yaml` of the same slug in the workspace wins.
- A seat's model: patch the agent with `extends: core` in your workspace's
  `agents/<slug>.yaml` and set `harness.model`.
- The agency's way of working: edit a playbook on `/dashboard/skills/<slug>`
  (a workspace with no folder edits its own copy in place; one with a folder
  adds `playbooks/<slug>/SKILL.md`), or approve the edits feedback proposes.
- One-line craft rules: seed them in `learnings/seo-feedback.yaml` with
  `extends: core`, or adopt them from feedback on `/dashboard/learnings`.
