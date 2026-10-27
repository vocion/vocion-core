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
- **Two records**, both carrying `projectId`: `seo_batch` (a set of pages for
  one client and topic, with its gate) and `seo_page` (one keyword, its page
  type, location and target URL, its status, the SERP brief, brief and draft
  artifacts, the model that ran each
  step, every feedback note with where it was filed, and the pull request and
  live URL once published).
- **A signed-off keyword plan**: `seo_plan_batch` files one sign-off showing
  the keyword map (keyword, page type, location, intent, cluster, new page or
  refresh). Nothing is briefed or drafted until a person approves it.
- **The volume gate**, enforced in code and per client project: a sample
  first (one page of each page type, at least 3), nothing more in any of the
  project's batches until a person signed off on every one; then a tranche
  of 10; then the rest. A page sent back with changes holds new drafts until
  its feedback is verifiably filed. A sign-off is bound to the draft's words:
  an edit afterwards puts the page back to review with a new ask.
- **Sign-offs filed by code**: the editor's pass files the page's ask, a
  redraft withdraws it, and an answer wakes the strategist to continue
  (`seo-continue-after-signoff`, on its `seo-batches-moving` mission).
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

- Gate sizes and publish targets: a person sets them under "Publishing" on
  the client's project page (for example a sample of 5, then 20). A missing
  or invalid value falls back to the default. No agent can change either:
  `update_object` refuses `seoGate` and `publishTargets`, and the project
  API takes them only from a signed-in person.
- A seat's model: patch the agent with `extends: core` in your workspace's
  `agents/<slug>.yaml` and set `harness.model`.
- House craft rules: seed them in `learnings/seo-feedback.yaml` with
  `extends: core`, or adopt them from feedback on `/dashboard/learnings`.
