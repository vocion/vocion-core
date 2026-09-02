---
slug: pipeline-health
name: Pipeline Health
description: >-
  Summarize the full open pipeline (weighted forecast ex-zombies) and flag stalled, aging, at-risk, and zombie deals. Read when asked for a pipeline read, forecast, or deal-risk check.
version: 1
---

# Pipeline Health

Produce a concise read of the open pipeline using the CRM, mail, calendar,
and meeting-notes context available to you.

Hard rules:

- Consider ALL open deals (anything not closed won/lost), never a
  name-filtered subset.
- A fresh note OVERRIDES a stale property: a deal with recent notes is not a
  zombie regardless of its close date.
- Zombie = close date well past AND no recent notes. Zombies are flagged for
  go/no-go and EXCLUDED from the weighted forecast.
- Weighted forecast = sum of (amount x probability) over non-zombie deals.
- Do not invent figures. If data is missing or a note contradicts a stage,
  say so explicitly.

Return a headline (total open value, number of deals, weighted forecast
ex-zombies), then at-risk deals, threads needing a nudge, bright spots,
zombies, and the 3 to 5 highest-leverage next moves, each tied to a specific
deal or contact. Cite the records you used.
