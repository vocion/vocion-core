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
  one client and topic, with its gate) and `seo_page` (one keyword, its
  status, the SERP brief, brief and draft artifacts, the model that ran each
  step, every feedback note with where it was filed, and the pull request and
  live URL once published).
- **The volume gate**, enforced in code: a sample of 3 pages first, nothing
  more until a person signed off on every one; then a tranche of 10; then the
  rest. A page sent back with changes holds new drafts until its feedback is
  filed. Sizes per project: `seoGate: {sample: 3, tranche: 10}` on the
  project.
- **Skills**: `onboard-client`, `serp-research`, `page-brief`, `write-page`,
  `review-page`, `feedback-to-wiki`, `publish-page`.
- **The learning step `seo-feedback`**: notes on sign-offs become candidate
  rules; adopted ones mount for the writer and the editor.
- **Pages**: SEO (every batch with its gate line and pages by status) and SEO
  pages (a batch's pages with keyword, status, models and links).

It turns on the `data-rooms` plugin (Projects kept current) and the Wiki with it. Projects themselves are core, in every app, so turning SEO on adds the SEO app and no other.

## Customising

- Gate sizes: set `seoGate` on a client's project (for example
  `{sample: 5, tranche: 20}`). A missing or invalid value falls back to the
  default; a prompt cannot change it.
- A seat's model: patch the agent with `extends: core` in your workspace's
  `agents/<slug>.yaml` and set `harness.model`.
- House craft rules: seed them in `learnings/seo-feedback.yaml` with
  `extends: core`, or adopt them from feedback on `/dashboard/learnings`.
