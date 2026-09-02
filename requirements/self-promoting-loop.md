# Self-Promoting Vocion — requirements & roadmap

The recurring loop where Vocion markets itself: pick a use case, build or
update its demo, document it, publish the blog, draft social, record the
walkthrough video — and file the one feature request the run surfaced, with
the community voting on it in GitHub, and an agent building the approved
ones into PRs.

Full brief (gap matrix, phases, governance):
https://claude.ai/code/artifact/3c1fd244-af25-41dd-ac06-23d0d516fdf5

## Why it's the flagship demo

Every run demonstrates the product's own pitch: named roles, human sign-off
on everything outbound, versioned learnings from what performs, budgets on
spend, a full audit trail. The tagline: **Vocion's marketing team is a
Vocion workspace.**

## What ships in this repo today (Phase 0 shell)

- `packages/core/demo/marketing-workspace/` — the team: Marketing Lead
  (strategy, analytics, reporting, execution) + Showcase Builder, Content
  Writer, Social Producer, Growth Analyst (`parent: marketing_lead`); two
  standing missions (`showcase_loop` Mon/Wed/Fri, `marketing_strategy`
  Mondays); the `showcase` tracker object; brand-voice + loop playbooks;
  `trust.yaml` growth ladder (all rules disabled); `seed-budgets.ts`
  (~$400/mo team envelope, stub).
- `.github/workflows/agent-build.yml` — the feature-request → PR sandbox,
  inert until `ANTHROPIC_API_KEY` is set and a human applies the
  `approved-for-build` label.

Phase 0 runs with ZERO new connectors: every artifact lands in the review
queue and a human does the posting. Editorial quality is proven before any
automation touches a public channel.

## Requirements roadmap

### Phase 1 — GitHub actions (~1 week)
- [ ] `github.issue` action handler in the propose_action catalog
      (GitHub App credential in the vault; contents/issues scope only)
- [ ] `github.pr` action handler (blog + docs land as reviewable PRs;
      merge = publish, Vercel already deploys on merge)
- [ ] Issue template with the voting call-to-action
- [ ] Blog template section that links the run's issue

### Phase 2 — distribution actions (~1–2 weeks + external lead time)
- [ ] `devto.post` handler (plain REST + API key; `canonical_url` back to
      vocion.ai — cheapest handler, ship first in this phase)
- [ ] `linkedin.post` handler (Community Management API — **start the app
      review on day 1; the approval is the long pole**)
- [ ] `x.post` handler (API v2, paid Basic tier ~$200/mo — confirm budget)
- [ ] Posts stay on Suggest indefinitely; Execute is earned via trust.yaml

### Phase 3 — video pipeline (~2 weeks)
- [ ] Walkthrough recorder skill: Playwright (already in core) drives the
      demo sandbox through a scripted run with video capture
- [ ] TTS voiceover from the blog post (OpenAI audio), ffmpeg mux
- [ ] `youtube.upload` handler (Data API; default quota covers 6/day)
- [ ] Depends on: demo sandbox stable on a host (PGlite-in-lambda abort is
      open; a small container host sidesteps it)

### Phase 4 — the learning loop (ongoing)
- [ ] Engagement sync into `showcase` tracker records (GitHub reactions,
      LinkedIn/X/YouTube analytics)
- [ ] Growth Analyst proposes learnings from performance; humans approve
      them into Content Writer's context

### Phase 5 — feature request → pull request (~1 week)
- [ ] Arm `.github/workflows/agent-build.yml`: `ANTHROPIC_API_KEY` secret
      (spend-capped key), verify claude-code-action pin
- [ ] `approved-for-build` + `found-by-agent` labels
- [ ] Branch protection: CI (types, lint, tests in `VOCION_LLM_MODE=replay`)
      is the hard merge gate; human review the soft one; merge is a click
- [ ] Dry-run on a small, well-specified issue before pointing it at
      community-voted ones

## Governance (non-negotiable)

Review queue on everything outbound until a channel earns Execute via
trust.yaml. Budgets per role with pre-flight refusal. Brand playbook is
versioned context — every post traces to the rules that produced it. Kill
switch per agent. Cadence starts at 3 runs/week; daily is earned. Content
is labeled: drafted by the Vocion marketing workspace, approved by a human.

## External channel

dev.to for the recurring loop (API-key REST, canonical_url, the right
audience). Show HN once, by a human, for the meta-story launch. Reddit
stays manual-only.

## Open questions

- Brand accounts vs. founder accounts for social (recommend: brand accounts
  in the loop; founder amplifies manually)
- X API budget approval (~$200/mo)
- Where the loop runs: Metacto's instance (agents.metacto.com) vs. a
  dedicated vocion-marketing deployment
