# Workspace manifest — `workspace.yaml`

The one required file in a workspace. It names the workspace, says which
organization owns it, sets the defaults every agent inherits, and declares
which base pack (if any) the workspace builds on.

| | |
|---|---|
| **Path** | `workspace.yaml` (or `workspace.yml`) at the workspace root |
| **Schema** | `WorkspaceManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `project` (lead, surfaces) + a `workspace_version` audit row |
| **Layering** | Not composable — the manifest is always the workspace's own |

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `version` | `1` | yes | Manifest format version. Only `1` is valid. |
| `orgId` | string | yes | Clerk organization id. Templates ship a placeholder; `workspace:apply --project` resolves it to the live project. |
| `name` | string | yes | Display name of the workspace. |
| `description` | string | no | One-paragraph summary, shown in the dashboard. |
| `lead` | slug | no | The workspace lead agent — the one that runs the whole workspace and consults the team leads. Applied to `project.leadAgentSlug`. Omit for no lead. |
| `accountableUser` | email | no | Workspace-default accountable human. Resolved to a user id at apply and stored on `project.accountableUserId`. Teams without their own `accountableUser` inherit this at read time. |
| `defaults.model` | string | no | Model every agent falls back to. |
| `defaults.temperature` | string | no | Temperature every agent falls back to. |
| `surfaces` | string[] | no (default `[]`) | Optional dashboard surfaces to switch on, by registry id. Today: `personalization`, `discovery` (see `packages/core/src/features/navigation/surfaces.ts`). An unknown id fails the load. |
| `extends` | string | no | Base-pack pin, e.g. `core@2.0.0`, or bare `core` to track the pack's current version. Omit for no base layer at all. |
| `use` | `all` \| selector | no | Which base-pack defaults to activate. See [base pack](./base-pack.md). Omitted while `extends` is set means activate nothing. |
| `disable` | selector | no | Suppress a base default even under `use: all`. |

A selector is `{agents: [...], skills: [...], playbooks: [...]}`; every key is optional.

## Example

```yaml
version: 1
orgId: proj_meridian_revenue
name: Meridian Outdoor — Revenue
description: >-
  Revenue workspace for Meridian Outdoor Supply. Four teams under one
  workspace lead.
lead: revenue-director
accountableUser: ops@meridian.example
defaults:
  model: gpt-5.4-mini
  temperature: '0.3'
surfaces: [discovery]
extends: core@2.0.0
use:
  agents: [revenue-director, proposal-writer]
  skills: [lead-triage]
disable:
  playbooks: [warming-etiquette]
```

## Rules

- `surfaces` entries must be ids this core registers; unknown ids fail `workspace:check` with the list of valid ids.
- `lead` must name an agent in this workspace.
- `use` naming a slug the pinned pack does not ship is a hard error.
- The pinned pack version is appended to `workspace_sha` (`<sha>+core@2.0.0`), so the same files on two pack versions stay distinguishable.

## Related

[Base pack](./base-pack.md) · [Agent](./agent.md) · [Team](./team.md) · [authoring guide](../workspace.md)
