# Workspace manifest — `workspace.yaml`

The one required file in a workspace. It names the workspace, says which
organization owns it, sets the defaults every agent inherits, and declares
which base pack (if any) the workspace builds on.

| | |
|---|---|
| **Path** | `workspace.yaml` (or `workspace.yml`) at the workspace root |
| **Schema** | `WorkspaceManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `project` (lead, goal, surfaces, plugins, mailbox) + a `workspace_version` audit row |
| **Layering** | Not composable — the manifest is always the workspace's own |

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `version` | `1` | yes | Manifest format version. Only `1` is valid. |
| `orgId` | string | yes | Id of the project (tenant) the workspace belongs to — auth.js (next-auth v5) session/org scoping, not Clerk. Templates ship a placeholder; `workspace:apply --project` resolves it to the live project. |
| `name` | string | yes | Display name of the workspace. |
| `description` | string | no | One-paragraph summary, shown in the dashboard. |
| `lead` | slug | no | The workspace lead agent — the one that runs the whole workspace and consults the team leads. Applied to `project.leadAgentSlug`. Omit for no lead. |
| `accountableUser` | email | no | Workspace-default accountable human. Resolved to a user id at apply and stored on `project.accountableUserId`. Teams without their own `accountableUser` inherit this at read time. |
| `goal` | string | no | The workspace's top-line goal, one sentence. Stored on `project.goal`; the team report anchors every team's spend share and KPI progress under it. |
| `mailbox` | object | no | Email as a chat surface. `mailbox: { enabled: true }` gives the workspace `<slug>@<VOCION_MAIL_DOMAIN>`; `address:` names one on that domain instead. Mail to it is answered by the workspace lead and threads into a conversation (`surface = email`); unknown senders become an `ask`. Stored on `project.mailboxAddress` / `mailboxEnabled`. Errors at apply if the deployment has no `VOCION_MAIL_DOMAIN` or the address is off it. See [the email guide](../guides/email.md). |
| `defaults.model` | string | no | Model every agent falls back to. |
| `defaults.temperature` | string | no | Temperature every agent falls back to. |
| `plugins` | string[] | no (default `[]`) | Plugins to turn on, by slug (`packages/core/templates/plugins/<slug>/`). Each is a bundle of agents, skills, object types, missions, automations, teams, pages and trust rules that composes under the workspace like the base pack — always active, overridable by slug with `extends: core`, suppressible with `disable:`. Dependencies (`depends:` in `plugin.yaml`) load first. The resolved list lands on `project.enabled_plugins`; a plugin's `surfaces` join `surfaces` below. See [`docs/plugins.md`](../plugins.md). |
| `surfaces` | string[] | no (default `[]`) | Optional dashboard surfaces to switch on, by registry id. Today: `personalization`, `discovery` (see `packages/core/src/features/navigation/surfaces.ts`). An unknown id fails the load. |
| `extends` | string | no | Base-pack pin, e.g. `core@2.1.0`, or bare `core` to track the pack's current version. Omit for no base layer at all. |
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
goal: Every open deal has a next step, and the team is never surprised by its pipeline.
mailbox:
  enabled: true # → meridian-revenue@<VOCION_MAIL_DOMAIN>, answered by revenue-director
defaults:
  model: gpt-5.4-mini
  temperature: '0.3'
surfaces: [discovery]
extends: core@2.1.0
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
- The pinned pack version is appended to `workspace_sha` (`<sha>+core@2.1.0`), so the same files on two pack versions stay distinguishable.

## Related

[Base pack](./base-pack.md) · [Agent](./agent.md) · [Team](./team.md) · [authoring guide](../workspace.md)
