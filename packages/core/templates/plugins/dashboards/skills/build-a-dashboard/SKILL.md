---
slug: build-a-dashboard
name: Build a dashboard
description: >-
  Build or refresh a dashboard — the page a team opens every day — with
  render_dashboard: the lead, headline figures with how they moved, a chart
  per trend titled with its finding, the tables people act from, dated and
  sourced, with the recipe that rebuilds it. A refresh follows that recipe
  and updates the same artifact.
version: 1
---

# Build a dashboard

A dashboard answers "how are we doing" for someone walking to the kitchen. It
is not a report: it is read every day, so it has to be right every day, and
the next refresh has to produce the same thing with new numbers.

## 1. Settle what it watches

From the ask: who opens it, and the three to seven numbers they would ask for
first. When the ask is one word ("an exec dashboard"), propose the figures in
one line and build — do not interview. Typical shapes (numbers invented):

- **Company snapshot:** revenue (last closed month, change vs the month
  before), gross margin (vs its target), operating income, revenue last 12
  months, weighted pipeline, closed-won last 90 days.
- **Pipeline:** open pipeline weighted and full, by expected close; won and
  lost this quarter; the ten largest open deals.
- **A team's week:** what shipped, what is at risk, what is waiting on whom.

## 2. Read every number, once

- Use the workspace's own reads: the ledger's P&L with a monthly split in one
  call (state the basis, accrual or cash), the CRM's deals in one query, the
  records the workspace keeps. Never one call per month.
- Keep closed periods apart from the period still in progress: the month to
  date is its own figure or a lighter last bar (`partialLast`), never mixed
  into a trend as if it were done.
- Keep actuals apart from forecast (pipeline, plan, run-rate).
- A number you could not read is `value: null`, said in one line of the
  summary. Never a guess.

## 3. Lay it out

```json
{
  "title": "Executive view",
  "summary": "Revenue was **$454.3K** in September, down 14% on August, with an operating result of **−$48.1K**. Open pipeline is **$992.2K** weighted.",
  "sources": "Finance from the ledger P&L (accrual), pipeline from CRM deals; read daily at 8am.",
  "asOf": "2026-10-29",
  "tabs": [
    {
      "label": "Overview",
      "sections": [
        {
          "title": "Company snapshot",
          "note": "Monthly figures are the last closed month; the current month is shown separately.",
          "blocks": [
            {
              "type": "stats",
              "items": [
                { "label": "Revenue", "value": 454300, "format": "currency", "delta": { "value": -14, "format": "percent", "against": "vs August", "better": "up" }, "note": "Sep 2026" },
                { "label": "Gross margin", "value": 31, "format": "percent", "target": { "value": 60 }, "note": "Sep 2026" },
                { "label": "Weighted pipeline", "value": 992200, "format": "currency", "note": "$2.7M open across 44 deals", "source": "CRM deals" }
              ]
            },
            { "type": "chart", "chart": { "title": "Revenue held near $450K a month", "type": "bar", "x": ["Nov", "…", "Oct"], "series": [{ "name": "Revenue", "values": [] }], "partialLast": true, "format": "currency", "source": "Ledger P&L, accrual", "asOf": "2026-10-29" } }
          ]
        }
      ]
    },
    {
      "label": "Initiatives",
      "sections": [
        {
          "title": "Initiatives, ranked",
          "note": "Status and next actions are judgement calls.",
          "blocks": [{ "type": "table", "table": { "columns": [{ "key": "initiative", "label": "Initiative" }, { "key": "score", "label": "Impact score", "type": "number" }, { "key": "status", "label": "Status", "type": "badge" }], "rows": [] } }]
        }
      ]
    }
  ],
  "refresh": { "cadence": "daily", "method": "…" }
}
```

- **The lead is the outcome.** Two or three sentences, the figures that
  matter in bold, the biggest move named. It is rewritten on every refresh.
- **Figures first, four to seven to a row**, the most important first. Give
  each a `delta` with `against` and `better` (colour follows them — never
  write a colour), a `target` when it is held to one, and a `note` for what it
  covers. `display` only for a figure that is not one number ("1 / 5").
- **One chart per trend**, titled with its finding, with `format`, `source`
  and `asOf`. Charts in one section sit side by side.
- **Tables for what people act from** — ranked, with the next action — and
  label judgement calls as such in the section note.
- **Tabs** only when the page is long: Overview first.

## 4. Write the recipe

`refresh.method` is how the next agent rebuilds it without you. For each
figure and chart: the read (tool, report, filters, basis, period), the
definition ("gross margin = revenue minus cost of goods sold, closed months"),
and any judgement call ("status is the worst of its workstreams"). Then the
cadence: `daily`, `weekly`, `monthly` or `on-request`.

## 5. Refresh

`list_artifacts` (kind `dashboard`) finds it; `read_artifact` reads it.
Follow `refresh.method` exactly, move `asOf`, rewrite the lead, and
`update_artifact` the whole spec with a change summary of what moved. Never
render a second dashboard.
