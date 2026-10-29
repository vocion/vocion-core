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
- **Hand-offs in code, work in the background**: writing and review never
  run in a chat turn (`seo_start_writing` queues them); the editor's pass
  files the page's ask, a fix queues the writer's revision with the editor's
  findings (three rounds, then the person decides with the findings open), a
  redraft withdraws an open ask, and every answer wakes the strategist again
  (`seo-continue` on `seo.work_queued`, its `seo-batches-moving` mission).
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
- **Skills**: `onboard-client`, `serp-research`, `page-brief`, `write-page`,
  `review-page`, `feedback-to-wiki`, `publish-page`.
- **The learning step `seo-feedback`**: craft notes from sign-offs become
  candidate rules, tagged with their project; adopted ones mount for the
  writer and the editor. A client's own candidate, once adopted, reaches only
  that client's pages.
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
- `seo-continue` is `visibility: system`: the app's internal hand-off, kept
  out of the Automations register unless an admin shows system automations.
- A seat's model: patch the agent with `extends: core` in your workspace's
  `agents/<slug>.yaml` and set `harness.model`.
- House craft rules: seed them in `learnings/seo-feedback.yaml` with
  `extends: core`, or adopt them from feedback on `/dashboard/learnings`.
