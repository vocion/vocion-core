---
slug: data-analysis
name: Data Analysis
description: >-
  Turn a question about numbers into a grounded answer and the right chart: read the ranges in one call, keep actuals apart from forecast, pick the chart form from the question, and render it with render_chart (or a chart block in a document). Read when asked for a trend, a breakdown, a forecast, a comparison, a variance or "chart that".
version: 1
---

# Data Analysis

You are answering a question with numbers. The person will act on what you
show, so every figure is traceable and every chart says one thing.

## 1. Read the numbers once, from the source

- Read a range in ONE call, split by period, never one call per month. A
  ledger report takes the whole range with a monthly split (for the Finance
  MCP, `quickbooks_report` with `summarize_by: "Month"`; for the core
  `finance_report`, its by-month option). A CRM or warehouse query groups by
  period in the query.
- Every figure you show ties to a read you made in this turn: name the source
  and the as-of date. Never sum records yourself when the system has the
  report; never fill a gap with a guess (a gap is `null`, said as a gap).
- Keep ACTUALS apart from FORECAST. Booked and invoiced is actual; pipeline,
  weighted pipeline, plan and run-rate are forecast. They are never one
  number and never one unmarked bar.

## 2. Pick the chart from the question

| The question | The chart |
|---|---|
| How much each period ("revenue by month") | Bars, each period's own amount (`aggregation: "period"`) |
| What it is made of, over time ("revenue by month by source", "actual plus pipeline") | Stacked bars by period (`stack: "stack"`), the forecast series marked |
| Shares over time ("mix by month") | 100% stacked bars (`stack: "percent"`) |
| Which is bigger, a few categories | Grouped bars, or sorted single bars |
| Which way it is heading, a rate or a balance | Line (`aggregation: "snapshot"` for balances); the forecast as `forecastFrom` (dashed) |
| How a start became an end ("bridge", "what moved margin") | Waterfall, with `waterfallTotals` naming the start, subtotals and end |
| Parts of a whole at one moment | 100% bar or a sorted bar — never a pie |

Rules the lint enforces (a violation refuses the chart and says what to fix):

- x holds one kind of thing: all periods (Jan…Dec, 2026-07, Q3) or all
  categories. A scenario ("year-end booked", "+ weighted pipeline") is a
  SERIES, never an x label.
- A running total is a line, never bars.
- One y axis. Two measures on different scales are two charts.
- At most eight series; fold the tail into "Other".
- Labels must read at a phone's width: shorten category labels, or chart fewer.
- Say the format: currency (with the code), percent, number, or a unit.
- If you give `totals`, the stack must sum to them.

## 3. Write it

- The TITLE is the finding, as a sentence: "On pace for $5.1M, carried by Q4
  renewals", not "Revenue by month".
- One message per chart. If there are two findings, make two charts.
- `source` and `asOf` on every chart; `forecastFrom` (or `forecast: true` on
  the series) on anything not yet actual; a `marker` at today when the chart
  runs past it; a `target` line for the plan when there is one.
- In chat, one or two sentences on what to notice; the chart carries the
  numbers, so do not repeat them as a table in text.

## 4. Render it with the engine

- `render_chart` for a chart on its own. Change it with `update_artifact`.
- Inside a document (`render_document`, `edit_document`), a chart block:

  ```html
  <figure class="vocion-chart">
    <script type="application/json">{ "title": "…", "type": "bar", "x": [...], "series": [...], "stack": "stack", "format": "currency", "source": "…", "asOf": "2026-10-23" }</script>
  </figure>
  ```

  The engine lints it, draws it at the sheet's width and redraws it from the
  spec on every edit.
- Never hand-write chart SVG or HTML: it is not linted, it does not reread on
  a phone, and it does not redraw when the numbers change.

## Example: "chart our revenue for the year"

Read the P&L once for Jan 1 to today by month, and open deals with close
dates this year at stage probability. Then:

```json
{
  "title": "On pace for $4.4M, with December carried by pipeline",
  "type": "bar",
  "x": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  "series": [
    { "name": "Invoiced", "values": [310000, 295000, 330000, 342000, 351000, 360000, 372000, 380000, 395000, 410000, 205000, 120000] },
    { "name": "Weighted pipeline", "values": [null, null, null, null, null, null, null, null, null, null, 140000, 260000], "forecast": true }
  ],
  "stack": "stack",
  "aggregation": "period",
  "forecastFrom": "Nov",
  "marker": { "x": "Oct", "label": "Today" },
  "format": "currency",
  "currency": "USD",
  "source": "Ledger P&L by month; CRM open deals at stage probability",
  "asOf": "2026-10-23"
}
```

Then say the finding and the year-end range in one or two sentences: booked
only, and booked plus weighted pipeline.
