# Dashboards

The page a team opens every day — headline figures, charts and tables, dated
and sourced — built from a sentence and kept current by an agent.

```yaml
# workspace.yaml
plugins: [dashboards]
```

## What it adds

| Piece | What it does |
|---|---|
| `agents/dashboard-analyst` | Builds a dashboard from the workspace's own reads, writes the recipe that rebuilds it, and refreshes it in place. Handles "dashboard", "KPI", "scorecard". |
| `skills/build-a-dashboard` | The method: what to watch, read once, lay it out, write the recipe, refresh. |
| `pages/dashboards` | Dashboards, under Workspace. One dashboard: the page is that dashboard. Several: a row each with its lead and as-of date. |
| `missions/dashboards-current` + `automations/dashboards-refresh` | "Every dashboard is current", checked weekday mornings: every due dashboard is refreshed from its recipe. Off until `scheduledRefresh` is on. |

Core gives every agent the mechanism: the `dashboard` artifact kind,
`render_dashboard`, `update_artifact`, `list_artifacts` and the `dashboards`
page archetype (`docs/guides/dashboards.md`). So the workspace lead can build
one without this plugin; the plugin adds the seat, the page and the schedule.

## Refreshing

- **Refresh** on a dashboard sends "Refresh the dashboard …" as the person's
  own turn. Their own connections (an `auth: person` source) are read, and
  the refresh is a new version of the same artifact.
- **On a schedule** (`scheduledRefresh: true`): only sources the workspace
  connects are read. A dashboard that needs someone's own sign-in is left as
  it is, and the run says which.

## Customise

- Another folder: override `pages/dashboards.yaml` with your own
  `source.folder`, or add a second page over a subfolder.
- Pin a dashboard to the sidebar from its artifact page.
