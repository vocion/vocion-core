# Team — `teams/<slug>.yaml`

A team groups agents under a lead and names the human accountable for its work.
Teams are how the dashboard organizes a workspace, and how a lead knows which
specialists it can hand work to.

| | |
|---|---|
| **Path** | `teams/<slug>.yaml` — **the filename is the slug** |
| **Schema** | `TeamManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `team` table |
| **Runtime** | Lead consultation merge in the harness |
| **Surface** | `/dashboard/teams` |
| **Layering** | Workspace-only — a base pack ships no teams |

There is no `slug:` field. The slug comes from the filename, so a team can
never disagree with its own path: `teams/revenue-ops.yaml` is `revenue-ops`.

Teams are flat by construction — no `parent` field here, and no parent column in
the `team` table.

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `name` | string | yes | Display name. |
| `description` | string | no | What the team is responsible for. |
| `lead` | slug | no | The agent leading this team. A team may exist before its lead is chosen — it renders as "no lead yet". |
| `accountableUser` | email | no | The accountable human. Resolved to a user id at apply. Omit to inherit `accountableUser` from `workspace.yaml`. |

Inheritance is resolved at read time and is *not* baked in on export, so the
workspace-level default stays the single place to change it.

## Example

```yaml
name: RevOps
description: >-
  Pipeline health, follow-ups, and revenue insight — keeps the funnel honest
  and flags anything going stale.
lead: revenue-lead
```

## Rules

- The filename must be a valid slug: lowercase, starts with a letter, letters/numbers/dashes/underscores.
- Slugs are unique across teams.
- `lead` must name an agent in this workspace.
- An agent's `team:` must name a team file — validated whenever the workspace defines any teams. A workspace with no `teams/` directory keeps the older free-text label behavior.
- An agent that leads a team must belong to that team. Either author the matching `team:` or omit it and let apply assign it.

## Related

[Agent](./agent.md) · [Workspace manifest](./workspace-manifest.md)
