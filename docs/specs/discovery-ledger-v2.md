<!-- The spec this PR implements: the Discovery Ledger v2 rebuild (classification semantics, the three dimensions, disagreements, reason codes, entities, the detail-page layout bug). -->

# Discovery Ledger v2 — CEO product review (Chris Fitkin, 2026-09-16)

Verbatim, except that every customer, company, person and email address below
is a fixture. The review as written named two real accounts, a real contact and
their real email address; the mapping from those to the fixtures is deliberately
NOT recorded here, because writing it down would put the originals back in the
repository — which is the one thing the substitution exists to prevent.

## Core diagnosis

This is close to being useful, but right now the Discovery Ledger feels more like an **agent debug log exposed as product UI** than an operational record a revenue leader can scan and trust. The core object is right. The hierarchy and terminology need a pass.

## Biggest issue: the score semantics look wrong

For Project Ranger the UI shows `discovery 0.95`, but the record says "Not a discovery call" and "Routed drop per discovery threshold". A normal user reads `discovery 0.95` as **95% probability this is a discovery call**. If 0.95 actually means "95% confidence in the classifier's decision that this is NOT discovery", the presentation is actively misleading.

It needs to become: **Not discovery** `95% confidence`. Then separately: **Proposal-ready** `82%`.

**Do not expose a score without exposing what class the score applies to.** This matters especially because this page establishes trust and accountability. An audit ledger cannot have ambiguous score semantics.

## The ledger should answer four questions

Every row, in about two seconds: 1. What meeting was this? 2. What did Vocion decide? 3. Why did it decide that? 4. What did the human do?

Right now I assemble that from the title, two scores, threshold numbers, a paragraph, `routed`, `review`, and a debug footer. Too much interpretation. Row anatomy closer to:

> **Project Ranger – Follow Up**
> Northwind Health · Kestrel Capital · Sep 14, 11:30 AM
> **Not discovery** · Existing opportunity / diligence follow-up
> Proposal-ready 82%
> Agent action: **No discovery workflow** · Human review: **Pending**
> Prospect already identified; bid due tomorrow; technical diligence underway.
> `View evidence`

## The taxonomy is muddled

Filters are **All · generate · confirm · drop**, but those are not the same kind of thing: `generate` is an action, `confirm` is a human-review state, `drop` is a routing outcome. There are at least three dimensions:

- **Classification** — Discovery · Not discovery · possibly Uncertain
- **Recommended action** — Generate proposal · Continue discovery · No action
- **Human disposition** — Pending · Accepted · Corrected · Dismissed

Do not collapse these into one status. Visible today as `routed confirm` next to `review: declined` — I cannot tell what the human declined: that it was discovery? to generate something? to confirm it? the whole recommendation? The ledger's reason to exist is making that explicit.

## Show Agent vs Human directly

| | Decision |
|---|---|
| **Vocion** | Discovery · 92% |
| **Recommended** | Generate proposal |
| **Human** | Declined |
| **Result** | No proposal created |

When they disagree, emphasize it: **Vocion: Generate** → **Human: Declined**. Make **Disagreements** a first-class filter — far more valuable than a generic `confirm 11` tab, because it supports calibration and learning.

## Make "why" a reason, not a summary

The row gives a long generated paragraph. I want a compact **reason code** plus one supporting sentence:

> **Not discovery** — Existing opportunity; diligence and bid preparation already underway.

Long model explanation goes behind **View reasoning / Evidence**. Consistent reason codes: First sales conversation · Existing opportunity · Internal meeting · Customer delivery call · Follow-up discovery · Diligence · No buyer present · Insufficient evidence. These become useful operational dimensions later.

## Move thresholds out of the primary UI

`thresholds 0.6 / 0.75` has essentially zero value while scanning; it is for debugging, evals and calibration. Put it under **Evidence & decision details** with: model decision, confidence, threshold, rule fired, transcript evidence, agent/version, prompt/version, run id, timestamp. The current footer (model, agent, run number, transcript id, workspace) is good information to retain but it is product telemetry, not row-level hierarchy. Collapse it.

## The account/entity presentation is wrong

The detail shows **Company** = an email address. An email address is not a company. This meeting involves several entities. Show:

> **Opportunity** Project Ranger / Northwind Health
> **Sponsor / referral source** Kestrel Capital
> **Attendees** Dana Reyes · Kestrel Capital / Chris Fitkin · Acme

If CRM entity resolution is imperfect, expose the uncertainty rather than pretending an email is a company: **Account not resolved** — Dana Reyes · dreyes@kestrelcapital.example. That is much safer.

## Detail page has a serious layout bug (P0)

The heading wraps to one word per line in a ~150px container while the rest of the page has huge unused space. The page should start **Project Ranger – Follow Up**, then `Discovery assessment · Sep 14, 11:30 AM`. The full generated meeting-name/date string should not be the H1 — that exposes an internal identifier as the page title instead of naming the object for a human. Same for the breadcrumb: **Needs you / Discovery / Project Ranger**, not the serialized display name.

## "On approve" is excellent conceptually, but rewrite it

Showing what approval will cause is important for agent trust. But it repeats the confusing score. Make it transactional:

> ### Approving will
> **Mark this assessment correct.** No downstream workflow will run because Vocion classified this as an existing-opportunity follow-up.

For something consequential: **Create a draft proposal** from this meeting and add it to Needs you for review. That pattern should exist everywhere in Vocion.

## The intro promises more than the rows deliver

"Every call the detection agent assessed — what it read, how it scored, the thresholds it decided under, and what a human did with it." The most important part is **what a human did with it**, yet human disposition is tiny (`review: declined →`). Invert the priority: **the decision history is the ledger; the model internals are supporting evidence.**

## The top of the page

Instead of **All 47 · generate 5 · confirm 11 · drop 31**:

**47 assessed** · **4 need review** · **6 corrected**, then controls: Decision ▾ · Human review ▾ · Reason ▾ · Date ▾, and quick chips: `Needs review` `Human disagreed` `Proposal generated`.

## The best default row

> **Project Ranger – Follow Up**
> Northwind Health · Sep 14, 11:30 AM
> **Not discovery** `95%`
> Existing opportunity; diligence and bid preparation already underway.
> Proposal-ready `82%` · **Human: Pending**
> **No action taken** — `View details →`

> **Growth Strategy call** — Acme · Sep 15, 4:30 PM
> **Discovery** `92%`
> Buyer needs, revenue goals and sales-process constraints discussed.
> Proposal-ready `88%` · **Human: Declined recommendation**
> **Agent recommended proposal generation** — `View details →`

## Disagreements are the hero capability

A ledger of 47 things the agent did correctly is mildly useful. A ledger showing "here are the 6 times humans corrected Vocion, here is why, and whether the next version improved" is genuinely valuable. It ties together decision traceability → human accountability → feedback → measurable improvement.

**Last 30 days:** 47 assessed · 41 human-reviewed · 36 agreed · 5 corrected · 88% agreement · +7 pts vs previous model version. Click **5 corrected** and the ledger filters immediately.

That is where this starts feeling like a real managed AI workforce control plane rather than a table of LLM runs.
