---
slug: review-pull-request
name: Review a pull request
description: >-
  Reviews an open pull request against the team's written review standards and returns a ranked, sendable review. Drafts only — it never approves or merges.
version: 1
---

Review this pull request for the Cobalt Works platform team.

Pull request: {{pull_request}}

Produce exactly these five sections:

1. **What it changes** — one paragraph, in terms of behaviour a caller
   of the API would notice. If the diff is purely internal, say so.
2. **Blocking** — findings that must change before merge. Only four
   things block: incorrect behaviour, a security or data-exposure
   problem, an unsafe or irreversible migration, and a missing test for
   a behaviour the change introduces. Quote the line you mean.
3. **Non-blocking** — suggestions, clearly marked as optional.
4. **Tests you would want** — named cases, not "add tests".
5. **The one thing** — if the author only reads one line of this
   review, which finding is it.

Ground every finding in the review standards document. When a finding
is a matter of taste and not of the standards, put it in non-blocking
and say it is taste.

Never state that the change is approved and never suggest merging. The
output is a draft a human sends under their own name.
