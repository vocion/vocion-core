# Charts

Vocion draws every chart from one spec with one engine: the chat card, the chart artifact, a chart inside a document, and a chart on a deck slide. Good charts come from three things, in this order: the model choosing the right form (with Auto giving it the model for the job), the prompt showing it how by example, and the library laying the chart out well at the width it is drawn at. Checks are few. Only data that cannot be drawn honestly is refused; everything else is the model's call, informed by a review of the chart as drawn.

Code: `packages/core/src/libs/charts/`
- `spec.ts`: the spec
- `layout.ts`: the geometry, and the layout decisions
- `checks.ts`: the refusals and the analyst's signals
- `review.ts`: the chart as drawn on a phone, for the model to judge
- `raster.ts`: the chart as a picture at a phone's width, for the review
- `ChartView.tsx`: the React drawing
- `svg.ts`: the SVG string drawing
- `documentBlocks.ts`: chart blocks in documents
- `palette.ts`: the colors

## Why

On 2026-10-23 the Finance Team answered "chart our revenue" with a hand-written chart inside a document: cumulative bars, months and year-end scenarios on one axis, labels on top of each other, clipped on a phone. The first engine (#1443) answered with a lint that refused such charts.

On 2026-10-24 the same team drew a P&L bridge from $5.11M revenue to $46K net income. It passed every rule and still did not read: interest, bonus, tax and net income were hairlines at the $6M scale, and the labels were codes ("CO", "Op", "Bon") explained in a legend line. Chris: "good charting should be driven by model choice, prompting, and libraries. Not over checking." So the rules that only policed layout became layout decisions in the library, the rest became signals for the model, and the model now sees what it drew.

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
| `series` | Each with `name`, `values` (one per x, `null` for a gap), optional `forecast`. Past 8, the layout keeps the 7 largest and folds the rest into "Other". |
| `format`, `currency`, `unit`, `compact` | How values read: `$4.3M`, `18%`, `12 deals`. The legacy `unit: "$"` still works. |
| `aggregation` | `period` (the period's own amount), `cumulative` (a running total) or `snapshot` (a balance) |
| `forecastFrom` | The first forecast x. That x and every later one are hatched on bars and dashed on lines. |
| `targets` | Up to 3 reference lines, e.g. the plan |
| `marker` | A vertical marker at one x, e.g. today |
| `totals` | The stated total per x. A stack must sum to it. |
| `waterfallTotals` | For a waterfall, the x labels drawn as full bars: the start, subtotals and the end. A total whose value is `null` is the running sum. |
| `waterfallStart` | For a waterfall, start the bridge at this subtotal, leaving out the bars before it |
| `orientation` | `auto` (default), `vertical` or `horizontal`. Auto turns bars horizontal when their names do not fit under them. |
| `trend` | A quiet least-squares line through the first series' actuals |
| `source`, `asOf` | The caption |
| `title`, `subtitle` | The title is the finding, not the axes |

The original card spec still validates as written: `{type, x, series, unit, stacked, trend, partialLast}`.

## Checks: few refusals, the rest signals

`checkChart(spec)` returns `refusals` and `signals`.

**Refusals** stop `render_chart`, `update_artifact` on a chart, and a document write with the block in it. They are only for data that cannot be drawn honestly:

| Rule | What it catches |
|---|---|
| `non-finite` | A value, total or target that is not a number |
| `stack-total` | A stack that does not sum to its stated `totals` |
| `mixed-units` | A series on a second y axis: two units on one axis |
| `waterfall-series` | A waterfall that is not one series of steps |

A series whose length does not match x is refused by the spec itself.

**Signals** ride back to the model with the review. They never refuse:

| Rule | What it notes |
|---|---|
| `mixed-axis` | x mixes periods (read by their form: month names, ISO dates, Q3, FY26, W14) with other categories |
| `cumulative-bars`, `running-total` | Bars of a running total, stated or likely |
| `no-format` | No `format` or `unit`: values draw as bare numbers |
| `stack-negative` | Negative values hidden in a stack |
| `forecast-unmarked` | `asOf` given, nothing marked forecast |
| `no-title`, `title-restates-axes`, `long-title` | The title does not state a finding |

What the first engine refused for layout (labels that collide, bars too thin, more than 8 series) the library now handles itself, below.

## Layout: the library's decisions

`layoutChart(spec, { width, height?, fontSize? })` returns a scene: shapes with coordinates, paints by role and palette slot, the legend, a description, the data as a table, and `facts`, what the layout decided.

- **Horizontal bars for names.** On a category axis, bars (and a waterfall) turn horizontal when a name cannot be drawn under its bar on two lines, or the bars would be thinner than 6px. Names run down the side in full, wrapped to two lines. Time stays on x: a period axis is never turned.
- **Wrap before cutting.** A category name wraps onto two lines before it is cut with an ellipsis. A period axis shortens months (January, Jan, J) and then shows every 2nd or 3rd, always naming the latest.
- **Waterfall split.** When a waterfall's last steps would draw under 6px at the scale of its first, it is drawn as the summary bridge (ending at its final total, labelled) and then a rescaled detail of those steps, starting at the subtotal before them ("Detail, rescaled: Operating profit to Net income"). `waterfallStart` starts the whole bridge at a subtotal instead.
- **Values on the bars.** A single-series bar (or up to three grouped) carries its value when it fits; a stack carries its column total; a waterfall carries each step signed ("−$2.5M") and drops the Increase/Decrease key. A line with two to five series is named at its ends instead of in a legend.
- **Fold past eight.** More series than the palette's eight slots: the 7 largest are drawn, the rest summed into "Other (n)".
- **Forecast.** Forecast bars are hatched and forecast lines dashed when a chart mixes actual and forecast. A waterfall that is all forecast says so in its caption.
- **Axes.** Bars start at zero; ticks are round; currency is compact ($4.3M).

**Two serializers draw the same scene:**
- `ChartView` (React, the card and the pane) measures its own width and lays out again on resize. It uses the `--viz-n` custom properties, so it works in light and dark.
- `renderChartSvg` / `sceneToSvg` (a self-contained SVG string with light hex colors) is for documents, decks and files.

## The review: the model judges what it drew

After `render_chart` draws a chart, its receipt carries `reviewChart(spec)`: the chart laid out at a phone's width (390px), in short lines. The form it took (split, turned horizontal), the narrowest bar, what was wrapped, cut or folded, any value left as a sliver with no label (with its px), and the signals. Then one question: does it answer what you were asked, do the numbers that matter read, is it the right form? The model revises once with `update_artifact` if it judges it should. The edit's receipt reviews the revision and says it is the one revision, so there is no loop.

**The picture.** Where the turn's model takes an image in a tool result, the review carries the chart itself: laid out at 390px, rasterized with `sharp` at up to 2x as WebP (`libs/charts/raster.ts`), under 150 KB (past that it is redrawn at 1x, and past that it is left out). The receipt is then two content blocks, the text first and the image after it (`services/agents/toolResultImages.ts`). The same goes for an `update_artifact` that re-renders a chart, as the one revision.

- **Who gets it.** The capability is read off the turn's chat model at compile time (`takesToolResultImages`, by the model's LangChain type), never by provider names in the tools: Anthropic models (Haiku, Sonnet, Opus) get the picture. OpenAI's tool messages take text only, Bedrock is not wired yet, and the AgentCore container and the out-of-process tool endpoint build their own context without the capability. All of those keep the text review, which still names every measured problem in px.
- **Seen once.** A middleware (`createSeenImagesMiddleware`) leaves the picture in for the model call right after the tool that drew it, and replaces it with one line of text on every later step of the turn, so it is paid for once.
- **Never stored.** The trace, the tool_call log and the live stream read a tool result's text blocks only (`toolOutputContent`), so the picture is not stored in conversation history or tool_call rows; the artifact itself is the record. Conversation history between turns is text, so the picture never comes back on a later turn.
- **Cost.** An image costs about width × height / 750 input tokens on Anthropic. A typical review picture is 780×520 px (390px at 2x), about 540 tokens, once per chart drawn and once more for a revision: well under a cent on any current model.

A document's chart blocks get the same notes on the `render_document` / `edit_document` receipt, briefer: the signals, plus anything the layout changed or left unreadable.

## Charts in documents

In `render_document` / `edit_document` HTML, write the spec, not the drawing:

```html
<figure class="vocion-chart">
  <script type="application/json">{ …the render_chart spec… }</script>
</figure>
```

Before verify, `DocumentEngine` validates, checks and draws every block at the sheet's content width (720px). It produces the title, SVG, legend, caption, and a hidden data table. The spec stays in the block, so every later edit redraws from it. The engine also adds a small style block so tables and charts never run wider than the sheet. An inline SVG with several bars outside a block gets a "drawn by hand" warning on the receipt.

## Decks

`renderChartSvg(spec, { width: 1600, height: 800, fontSize: 22 }, '<unique id>')` returns an SVG string to drop into a slide. The deck engine (`libs/decks`) doesn't call it yet. Wiring it needs two things: an `x-chart` element in `runtime.ts` that reads a spec, mirroring `x-icon`, and the deck audit counting it as generated SVG.

## The analyst skill and the model

`templates/base/skills/data-analysis/SKILL.md` is the method, by worked example (fictional numbers): revenue by month as stacked bars with forecast months; a P&L bridge with full names and an operating-profit subtotal; year-end scenarios as their own small chart; many named things as bars the library turns horizontal. It also says to read ranges in one call, keep actuals apart from forecast, title with the finding, and let the library lay the chart out.

**Who gets it:**
- **Every agent with the render tools** reads the method in `render_chart`'s description (reading ranges once, actuals apart from forecast, the same examples, shorter) on every turn, and the document tool's description of chart blocks points to it with one compact example. Both stand on their own: a workspace that cannot mount the base pack's skill (Metacto's Finance and Revenue, 2026-10-24) has its prompts say "follow the method in render_chart's description".
- **The full skill** is in the base pack: a workspace that composes `core` with `use: all` has it, and any agent can list `data-analysis` in its skills.

**The model for the job:** Auto's effort read reports a typed `analysis` fact (`none`, `chart`, `multi`). A chart or an analysis to look at is never Quick; one across more than one statement or scenario runs Deep (`docs/guides/effort-and-models.md`).
