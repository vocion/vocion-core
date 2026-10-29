# Dashboards

A dashboard is the page a team opens every day: the lead (what the numbers
say), headline figures with how they moved, a chart per trend, and the tables
people act from — dated, with where every number comes from, and kept current
by an agent. It is an artifact (`kind: dashboard`), so versions, sharing,
pinning and the log come with it, and a refresh is a new version of the same
dashboard, never a copy.

Code: `packages/core/src/libs/dashboards/`
- `spec.ts`: the spec
- `checks.ts`: the refusals (each chart's own) and the notes on the receipt
- `format.ts`: figures, deltas and dates as they read
- `libs/cards/firstParty/dashboard.tsx`: the view (chat and pane)
- `features/dashboard/dashboards/DashboardsPage.tsx`: the `dashboards` page archetype

## Why

On 2026-10-29 Metacto's executives were running the company from a dashboard
built by hand in another tool — revenue, margin, operating income, pipeline,
initiatives ranked — kept current by asking for it again each time. Every part
of it Vocion already drew: a headline number is a `Stat`, a chart is the chart
engine's spec, a table is the table card's. What was missing was the noun that
holds them with the three things that make a dashboard: when its numbers are
as of, where they come from, and how to build it again.

## The spec

```json
{
  "title": "Northwind operating view",
  "summary": "Revenue was **$454.3K** in September, down 14% on August.",
  "sources": "Ledger P&L (accrual) and CRM deals, read daily at 8am.",
  "asOf": "2026-10-29",
  "tabs": [
    {
      "label": "Overview",
      "sections": [
        {
          "title": "Company snapshot",
          "note": "Last closed month.",
          "blocks": [
            {
              "type": "stats",
              "items": [
                {
                  "label": "Revenue",
                  "value": 454300,
                  "format": "currency",
                  "delta": { "value": -14, "format": "percent", "against": "vs August", "better": "up" },
                  "note": "Sep 2026"
                },
                { "label": "Gross margin", "value": 31, "format": "percent", "target": { "value": 60 } }
              ]
            },
            { "type": "chart", "chart": { "…a render_chart spec…": true } }
          ]
        }
      ]
    },
    { "label": "Initiatives", "sections": [{ "blocks": [{ "type": "table", "table": { "…a render_table spec…": true } }] }] }
  ],
  "refresh": { "cadence": "daily", "method": "Revenue: ledger P&L by month, accrual, closed months…" }
}
```

| Field | What it does |
|---|---|
| `summary` | The lead, rewritten on every refresh. Markdown; the figures that matter in bold. |
| `sources` | One line under the lead: where the numbers come from and how fresh. |
| `asOf` | Required. When the numbers were read. |
| `tabs` | One tab draws no tab bar. Each holds sections of blocks. |
| block `stats` | Up to 12 figures in a `StatRow`. A figure's colour comes from `delta.better`, never from the model. `value: null` reads "Not read"; `display` is for a figure that is not one number ("1 / 5"). |
| block `chart` | A `render_chart` spec, drawn by the chart engine. Charts next to each other share a row. |
| block `table` | A `render_table` spec. |
| block `text` | A short passage: a finding that needs a sentence. |
| `refresh` | `cadence` (`daily`, `weekly`, `monthly`, `on-request`) and `method`, the recipe: each figure's read and definition, and the judgement calls. Shown behind "How it's built". |

## Tools

- `render_dashboard` (every agent, like `render_chart`): validates the spec,
  holds every chart to the chart engine's refusals, files it in the
  `dashboards` folder and opens it beside the conversation. The receipt counts
  what was drawn and notes what the model should judge: a chart that came out
  as slivers, a figure that could not be read, no sources, no recipe.
- `update_artifact`: a refresh or a change, as a new version. Charts are held
  to the same refusals.
- `list_artifacts`: finds dashboards (kind `dashboard`) with their `asOf` and
  cadence, so "refresh the executive dashboard" needs no id.

All three reach MCP through the agent-tools bridge.

## Refresh

**Refresh** on a dashboard opens the chat with the person's own words —
"Refresh the dashboard "…" (artifact #id) with current numbers, following its
refresh method" — sent as their turn. So their own connections are read (an
`auth: person` MCP source follows the person into every chat turn, never into
a schedule), and the refresh runs as their action.

The dashboards plugin's `dashboards-refresh` automation (setting
`scheduledRefresh`, off by default) refreshes what is due each weekday
morning from the workspace's own sources. A dashboard whose recipe needs a
person's sign-in is left as it is, and the run says which.

## The page

The `dashboards` archetype lists the dashboards in its `source.folder` (or
every dashboard): one, and the page is that dashboard, full width; several, a
row each with its lead and as-of date, opening at `/dashboard/p/<slug>/<id>`.
History and sharing are the artifact's, one link away.

## The plugin

`plugins: [dashboards]` adds the Dashboard analyst (handles "dashboard",
"KPI", "scorecard"), the `build-a-dashboard` skill, the Dashboards page and
app, and the optional schedule. The mechanism above works without it: the
workspace lead can build a dashboard on its own.
