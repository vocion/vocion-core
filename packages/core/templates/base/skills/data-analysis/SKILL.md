---
slug: data-analysis
name: Data Analysis
description: >-
  Turn a question about numbers into a grounded answer and the right chart: read the ranges in one call, keep actuals apart from forecast, choose the chart's form from the question, title it with the finding, and let render_chart (or a chart block in a document) lay it out. Read when asked for a trend, a breakdown, a forecast, a bridge, a comparison, a variance or "chart that".
version: 2
---

# Data Analysis

You are answering a question with numbers. The person will act on what you
show, so every figure is traceable and every chart says one thing.

You choose the form, the series and the finding. The chart library does the
layout: it turns bars horizontal when names are long, wraps labels, puts each
value on its bar, folds series past eight into "Other", and draws a waterfall
whose last steps would be slivers as its summary plus a rescaled detail. Do
not shorten names to make them fit; write them in full and let it lay them out.

## 1. Read the numbers once, from the source

- Read a range in ONE call, split by period, never one call per month. A
  ledger report takes the whole range with a monthly split (for the Finance
  MCP, `quickbooks_report` with `summarize_by: "Month"`; for the core
  `finance_report`, its by-month option). A CRM or warehouse query groups by
  period in the query.
- Every figure you show ties to a read you made in this turn: name the source
  and the as-of date. Never sum records yourself when the system has the
  report; a gap is `null`, said as a gap, never a guess.
- Keep ACTUALS apart from FORECAST. Booked and invoiced is actual; pipeline,
  weighted pipeline, plan and run-rate are forecast. They are never one
  number and never one unmarked bar.

## 2. Choose the form from the question

Ask what the person will do with the answer, then pick the chart that makes
that one thing obvious. The examples below use invented numbers.

### "What's revenue doing this year?" — stacked bars by month, forecast marked

Composition over time, with the months still to come drawn as forecast:

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

### "How does revenue become profit?" — a P&L bridge with full names

Name every step in full and give the subtotals, so the reader can follow the
money. Include an operating-profit subtotal: when the last steps are small
next to revenue, the library draws them as a rescaled detail starting there.

```json
{
  "title": "$5.1M of revenue leaves $46K of net income",
  "type": "waterfall",
  "x": ["Revenue", "Delivery cost", "Gross profit", "Operating expenses", "Operating profit", "Interest", "Bonus pool", "Tax", "Net income"],
  "series": [{ "name": "FY2026 base case", "values": [5110000, -2520000, null, -2478000, null, -38000, -4600, -23400, null], "forecast": true }],
  "waterfallTotals": ["Revenue", "Gross profit", "Operating profit", "Net income"],
  "format": "currency",
  "currency": "USD",
  "source": "Ledger P&L, year to date plus base case",
  "asOf": "2026-10-24"
}
```

(A total's value is drawn from the running sum; `null` there is fine.) When
the question is only about the last steps ("what takes profit down to $46K?"),
start the bridge there with `"waterfallStart": "Operating profit"`.

### "Where does the year land?" — scenarios as their own small chart

Scenarios are not periods. Never add "EOY" bars to a monthly axis:

```json
{
  "title": "The year lands between $4.9M and $5.3M",
  "type": "bar",
  "x": ["Low", "Base", "High"],
  "series": [{ "name": "Year-end revenue", "values": [4900000, 5110000, 5260000], "forecast": true }],
  "format": "currency",
  "currency": "USD",
  "source": "Ledger plus open pipeline",
  "asOf": "2026-10-24"
}
```

### "Who are our biggest customers?" — names in full

```json
{
  "title": "Three customers carry half of this year's revenue",
  "type": "bar",
  "x": ["Northwind Regional Holdings", "Kestrel Capital Partners", "Larkfield Construction Group", "Other customers"],
  "series": [{ "name": "Revenue", "values": [1310000, 820000, 540000, 2440000] }],
  "format": "currency",
  "currency": "USD",
  "source": "Ledger, invoices by customer",
  "asOf": "2026-10-24"
}
```

The library draws these horizontally on a phone, names down the side.

### The rest

| The question | The chart |
|---|---|
| How much each period | Bars of each period's own amount (`aggregation: "period"`) |
| Shares over time ("mix by month") | `stack: "percent"` |
| Which way it is heading, a rate or a balance | `line` (`aggregation: "snapshot"` for balances), forecast via `forecastFrom` |
| A few categories side by side | Grouped bars |
| Parts of a whole at one moment | A sorted bar or a 100% bar, never a pie |

A running total reads better as a line than as bars; two measures on
different scales are two charts.

## 3. Write it

- The TITLE is the finding, as a sentence, not the axes.
- One message per chart. Two findings, two charts.
- `format` (currency with its code, percent, number, or a unit), `source` and
  `asOf` on every chart.
- In chat, one or two sentences on what to notice; the chart carries the
  numbers, so do not repeat them as a table in text.

## 4. Render, then look

- `render_chart` for a chart on its own; inside a document, a chart block:

  ```html
  <figure class="vocion-chart">
    <script type="application/json">{ "title": "…", "type": "bar", "x": [...], "series": [...], "format": "currency", "source": "…", "asOf": "2026-10-24" }</script>
  </figure>
  ```

- Never hand-write chart SVG or HTML.
- Only data that cannot be drawn honestly is refused: a value that is not a
  number, a stack that does not sum to its stated `totals`, two units on one
  axis.
- The receipt reviews the chart as drawn at a phone's width: what the layout
  did, anything too small to read, and an analyst's notes. Judge it against
  the question. If it does not answer it, revise once with `update_artifact`
  (a different form, fewer series, a better title). If it does, move on.
