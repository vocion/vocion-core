# Charts

Vocion draws every chart from one spec with one engine: the chat card, the chart artifact, a chart inside a document, and a chart on a deck slide. Each chart is linted before anyone sees it, and laid out at the width it is drawn at, so it reads on a phone.

Code: `packages/core/src/libs/charts/`
- `spec.ts`: the spec
- `layout.ts`: the geometry
- `lint.ts`: the rules
- `ChartView.tsx`: the React drawing
- `svg.ts`: the SVG string drawing
- `documentBlocks.ts`: chart blocks in documents
- `palette.ts`: the colors

## Why

On 2026-10-23 the Finance Team answered "chart our revenue" with a hand-written chart inside a document. It had cumulative bars, with the months (Jul, Aug, Sep, "Oct 23*") and two year-end scenarios ("EOY: booked", "+weighted") on one axis. Its labels ran into each other, and it was clipped on a phone. It should have been monthly revenue as stacked bars, with November and December stacked as invoiced plus weighted pipeline and the pipeline marked as forecast. Each of those faults is now a lint rule, and the stacked form is one spec.

## The spec

```json
{
  "title": "On pace for $4.4M, with December carried by pipeline",
  "type": "bar",
  "x": ["Jan", "Feb", "…", "Dec"],
  "series": [
    { "name": "Invoiced", "values": [310000, 295000, "…"] },
    { "name": "Weighted pipeline", "values": [null, "…", 140000, 260000], "forecast": true }
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

| Field | What it does |
|---|---|
| `type` | `bar`, `line`, `area` or `waterfall` |
| `stack` | `none` (grouped), `stack`, or `percent` (100%). The legacy `stacked: true` means `stack`. |
| `x` | Labels in order: all periods or all categories |
| `series` | Up to 8, each with `name`, `values` (one per x, `null` for a gap), optional `forecast` |
| `format`, `currency`, `unit`, `compact` | How values read: `$4.3M`, `18%`, `12 deals`. The legacy `unit: "$"` still works. |
| `aggregation` | `period` (the period's own amount), `cumulative` (a running total) or `snapshot` (a balance) |
| `forecastFrom` | The first forecast x. That x and every later one are hatched on bars and dashed on lines. |
| `targets` | Up to 3 reference lines, e.g. the plan |
| `marker` | A vertical marker at one x, e.g. today |
| `totals` | The stated total per x. A stack must sum to it. |
| `waterfallTotals` | For a waterfall, the x labels drawn as full bars: the start, subtotals and the end |
| `trend` | A quiet least-squares line through the first series' actuals |
| `source`, `asOf` | The caption |
| `title`, `subtitle` | The title is the finding, not the axes |

The original card spec still validates as written: `{type, x, series, unit, stacked, trend, partialLast}`.

## The lint

`lintChart(spec)` returns errors and warnings. Errors refuse `render_chart`, refuse `update_artifact` on a chart, and fail a document write that contains the chart block. Each one says what to fix.

| Rule | Level | What it catches |
|---|---|---|
| `mixed-axis` | error | x mixes periods with other categories. Labels are read as periods by their form: month names, ISO dates, Q3, FY26, W14. |
| `cumulative-bars` | error | Bars of a running total (`aggregation: "cumulative"`) |
| `running-total` | warning | Bars on a period axis that rise every period, with no `aggregation` stated |
| `label-collision` | error | A category label that can't be drawn without overlapping at 360px or 960px, even truncated |
| `too-many-categories` | error | Bars thinner than 4px on a phone |
| `missing-format` | error | No `format` or `unit` |
| `dual-axis` | error | A series on a second y axis |
| `stack-total` | error | A stack that doesn't sum to its stated `totals` |
| `stack-negative` | warning | Negative values in a stack |
| `waterfall-series` | error | A waterfall with more than one series |
| `forecast-unmarked` | warning | `asOf` is given but nothing is marked forecast |
| `no-title`, `title-restates-axes`, `long-title` | warning | The title doesn't state a finding |

More than 8 series is refused by the spec itself, with the same advice: fold the tail into "Other".

## Layout and drawing

`layoutChart(spec, { width, height?, fontSize? })` returns a scene. A scene is shapes with coordinates, paints by role and palette slot, the legend, a description and the data as a table.

**On a phone:**
- On a period axis, month labels shorten (January, Jan, J) and then thin to every 2nd or 3rd. The last period is always named.
- On a category axis every bar keeps its label, truncated, and one that still doesn't fit is a lint error.

**Two serializers draw the same scene:**
- `ChartView` (React, the card and the pane) measures its own width and lays out again on resize. It uses the `--viz-n` custom properties, so it works in light and dark.
- `renderChartSvg` / `sceneToSvg` (a self-contained SVG string with light hex colors) is for documents, decks and files.

## Charts in documents

In `render_document` / `edit_document` HTML, write the spec, not the drawing:

```html
<figure class="vocion-chart">
  <script type="application/json">{ …the render_chart spec… }</script>
</figure>
```

Before verify, `DocumentEngine` validates, lints and draws every block at the sheet's content width (720px). It produces the title, SVG, legend, caption, and a hidden data table. The spec stays in the block, so every later edit redraws from it. The engine also adds a small style block so tables and charts never run wider than the sheet. An inline SVG with several bars outside a block gets a "drawn by hand" warning on the receipt.

## Decks

`renderChartSvg(spec, { width: 1600, height: 800, fontSize: 22 }, '<unique id>')` returns an SVG string to drop into a slide. The deck engine (`libs/decks`) doesn't call it yet. Wiring it needs two things: an `x-chart` element in `runtime.ts` that reads a spec, mirroring `x-icon`, and the deck audit counting it as generated SVG.

## The analyst skill

`templates/base/skills/data-analysis/SKILL.md` is the method:
- read ranges in one call (a ledger report split by month);
- keep actuals apart from forecast;
- pick the chart from the question;
- make the title the finding;
- always render with the engine.

**Who gets it:**
- **Every agent with the render tools** gets the core of it in `render_chart`'s description and in `render_document`'s description of chart blocks, which they read on every turn. The lint enforces the hard rules regardless.
- **The full skill** is in the base pack, so a workspace that composes `core` with `use: all` has it, and any agent can list `data-analysis` in its skills.
