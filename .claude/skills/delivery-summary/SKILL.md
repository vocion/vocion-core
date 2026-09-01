---
name: delivery-summary
description: Generate a non-technical delivery summary of shipped agent-platform work, structured by agent functionality (capabilities, tools, test questions unlocked, workflows unlocked), published as a Claude Artifact. Use when the user asks for a delivery summary, a "what shipped" writeup, a client-facing recap of a ticket / day / week of work, or says things like "summarize what we delivered", "write up ticket 035 for Chris", or "delivery summary for this week".
---

# Delivery Summary

Turn shipped platform work into a delivery summary the client's CEO can read in
about three minutes: which agents were worked on, what tools or skills they gained,
why it matters to the engagement's overall goal, and what to type into chat to see
it work. Always published as a Claude Artifact.

## Brevity is a hard requirement

The whole page reads in about three minutes. No stat bands, hero metrics, or
dashboard flourishes; platform record counts (total contacts, deals, companies)
appear only inside a test-question answer or a before/after fact, never as
decoration. Test-question table caps at 8 to 10 rows. When trimming, keep the
wrong-answer-now-impossible material and cut description.

## Audience and altitude

The reader is the client CEO (Chris). He is non-technical for implementation detail
but wants the technical underpinnings of the Vocion platform at the architecture
level. Calibrate per section:

- **Tools, test questions, workflows**: plain English descriptions, but the actual
  tool and agent names appear explicitly. The reader must be able to answer "which
  agent was worked on, and what tools or skills were developed" at a glance.
- **What changed (before/after)**: platform-technical is welcome. Name the
  architecture moves (semantic search vs SQL, the structured mirror, one read path,
  typed tools). Never implementation internals: no index types, column formats,
  file paths, or function names.

## Scope input

Accept any of: a ticket number, a plan/artifact, a date range, "this week", or
nothing. With no scope given, cover work since the last delivery summary in
`Proj_Revenue_Operations/artifacts/delivery-summaries/` (or the last week if none
exists). Confirm the inferred scope in one line before generating only if it is
genuinely ambiguous.

## Ground it before writing

Read, in this order, and treat the latest verified record as the answer key when
sources disagree (a plan's draft numbers lose to the milestone's verified numbers):

1. `Proj_Revenue_Operations/MILESTONES.md` rows in scope (the verified record)
2. The ticket file(s) in `Proj_Revenue_Operations/tickets/`
3. Any implementation plan or artifact the work followed
4. `Proj_Revenue_Operations/core-vs-workspace-audit.md` plus the actual diff split
   (changes in `vocion-core` vs the `metacto-vocion-agents` workspace) for the appendix
5. For the headline's goal framing: the engagement north star. Today that is the
   personalization and proposal workflows (see
   `Proj_Revenue_Operations/artifacts/personalization-agent-build-plan-step-1.md`
   and tickets 028/029). Re-derive from current tickets rather than hardcoding.

Every number and claim must trace to one of these sources. Claims about who has a
tool and how it is enabled must be verified in the code, not paraphrased from a
plan: source-gated (built when the agent's `connectorSources` include the
connector), granted-only (`harness.grantTools`), and per-agent withholding
(`harness.excludeTools`) are three different mechanisms, and the summary must
describe the one actually in play. Anything unverified
renders as an amber placeholder, never as fact. If the `metacto-vocion-agents` pin
looks stale relative to the milestones being summarized, say so instead of
summarizing code that is not in the tree.

## Structure (exactly these sections, in this order)

1. **Header band**: the Metacto logo (embed
   `assets/logos/metacto-horizontal-black.png` as a base64 data URI, never text in
   place of the mark and never `metacto-logo.svg`, which is a different mark; the
   wordmark is lowercase "metacto" with the orange emblem) aligned to the RIGHT of
   the header with 40px of space below it, then the h1, then a meta line reading
   `Update: {Month Day Year} | Delivery Summary`, then the agents worked on
   (named), and a two-beat headline: what shipped, then what it unlocks toward the
   overall goal. The page title (h1) is always structured
   `{agent or workspace}: {enhancement}`, e.g. "Metacto RevOps: CRM Data Source
   Enhancement". No engagement/platform label and no ticket number in the header;
   the ticket lives in the footer only. Headline
   example shape: "The agent now answers CRM questions with exact numbers from a
   single trusted store. This is the data foundation the personalization and
   proposal workflows build on."
2. **What changed**: before/after at platform-architecture altitude, one short
   paragraph each. Lead with the failure the client could see, then the structural
   fix. A concrete wrong answer that is now impossible is the strongest material.
   When the scope widened what data the platform carries (new mirrored fields, a
   new source, new record types), list the additions explicitly, grouped by record
   type, rather than burying them in prose. No standalone mechanism callouts (a
   boxed "the guard that matters" reads as confusing): a safeguard earns its place
   inside the before/after prose or as a test question, or it is cut.
3. **Capabilities delivered**: the section heading summarizes what was delivered
   in domain terms (e.g. "Structured CRM reads: contacts, deals, companies, and
   on-demand freshness"), never a count like "four capabilities". Then a compact
   table, one row per capability developed or upgraded, with columns: Capability
   (its actual name), Type (tool, skill, operation, workflow, connector), Agents
   (which agents got access to it, verified in code per the grounding rule; "All
   agents" when unconditional, and when a capability is broadly available but does
   not grant data access, the cell must say so, e.g. "All agents, refresh trigger
   only, no data access", so availability is never read as data access), and What
   it does in plain English (1-2 lines). No
   prose paragraph about enablement mechanics; the Agents column carries who got
   what.
4. **Try it yourself**: questions now unlocked, phrased exactly as a person would
   type them, each with what a good answer looks like. Use real verified numbers
   and state the as-of date once, above the table, so stale numbers read as a
   snapshot rather than a promise. 8 to 10 rows maximum.
5. **Agent workflows unlocked**: autonomous agent workflows added or changed in
   this scope: scheduled automations, missions, triggers (e.g. "the discovery
   sweep now runs hourly and feeds on Granola notes"). These are things agents now
   do on their own, never human conveniences. **Omit this section entirely when
   the scope added no agent workflow**; a tool that merely enables a future
   workflow does not qualify.
6. **Appendix: what lives where**: a two-column table, Vocion core (the platform,
   reusable capability) vs the Metacto workspace (client-specific configuration).
   Derive rows from where the changes actually landed in the repo split. 3 to 4
   rows.
7. **Footer**: period covered, tickets/plans this summarizes, verification status
   in one factual line (what was verified and what still follows), "Prepared by the
   Metacto team", date.

There is no "honest edges" or limitations section. Deliberate non-goals and pending
verification live only in the one-line footer status, stated as fact.

## Voice

- House rules apply in full: no em-dashes anywhere, no antithesis phrasing
  ("not X, but Y"), Metacto with a capital M, "the Metacto team", capabilities
  never headcount, never promise business outcomes; report actuals.
- Short sentences. Numbers over adjectives. Every "why it matters" earns its place
  by naming something the client recognizes.

## Output

- Write the page to
  `Proj_Revenue_Operations/artifacts/delivery-summaries/YYYY-MM-DD-<slug>.html`
  so summaries are versioned in the dataroom, then publish with the Artifact tool
  (favicon `📦`, keep it stable across redeploys; updates to an existing summary
  redeploy the same file path).
- Style: Metacto light document. Copy the `:root` token block from
  `assets/css/brand.css` into the page's own `<style>` (self-contained; no external
  requests). Cream background, dark-teal headings, orange for numbers and accents,
  hairline tables. Barlow for headings and Inter for body with system fallbacks.
  The design commits to the light look: paint background and text colors
  explicitly on `body`.
- Load the `artifact-design` skill before writing the page.
- The page `<title>` matches the h1 (`{agent or workspace}: {enhancement}`).
- Embed Barlow and Inter as `@font-face` data URIs (the woff2 blobs are reusable
  from any prior delivery summary in `delivery-summaries/`) so brand type
  survives the artifact CSP; never link a font CDN.
