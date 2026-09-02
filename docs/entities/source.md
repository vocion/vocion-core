# Source — `sources/<slug>.yaml`

A source is a connection to outside data: a mailbox, a CRM, a drive, the web.
The manifest declares which connector to use, its settings, how often to sync,
and who is allowed to retrieve from it. **Credentials never live here** — they
go in the runtime's encrypted vault, attached to the source after apply.

| | |
|---|---|
| **Path** | `sources/<slug>.yaml` |
| **Schema** | `SourceManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `knowledge_source` table |
| **Runtime** | `SourceSyncService.runSync`, via the connector registry |
| **Surface** | `/dashboard/sources` |
| **Layering** | Workspace-only — a base pack ships no sources |

## Fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. Agents reference it in `connectorSources:`. |
| `name` | string | required | Display name on the Sources page. |
| `description` | string | — | One-line summary for the catalog. |
| `kind` | string | required | Connector kind — must match a registered connector in `libs/sources/registry`. Built-ins: `web`, `local-files`. |
| `config` | object | `{}` | Per-connector settings, validated against that connector's own config schema at apply. |
| `schedule` | cron | — | Scheduled sync cadence. Omit for manual-only syncing from `/dashboard/sources`. |
| `reconcileSchedule` | 5-field cron \| `false` | connector default | Cadence for a periodic *full* sync that tombstones records deleted upstream, which incremental syncs cannot see. `false` disables the reconcile pass. |
| `access.visibility` | `org` \| `restricted` | `org` | `restricted` limits retrieval — chat and search — to the listed members, enforced as an intersection at query time. Scheduled team runs keep access. |
| `access.users` | email[] | `[]` | The members allowed when `visibility: restricted`. |
| `enabled` | boolean | `true` | Set `false` to keep the file but stop syncing. |

A `kind` may be a *labelled* connector — e.g. `zendesk` — that routes through a
built-in connector at the registry level while no live implementation is wired
yet. That is the pattern behind the demo sources.

## Example

```yaml
slug: hubspot
name: HubSpot CRM
description: Deals, contacts, and companies for the revenue org.
kind: hubspot
config:
  portalId: '12345678'
  objects: [deals, contacts, companies]
schedule: '*/30 * * * *'
reconcileSchedule: '0 4 * * 0'
access:
  visibility: restricted
  users:
    - revops@meridian.example
enabled: true
```

## Rules

- Slugs are unique across sources.
- `kind` must resolve to a registered connector; `config` is validated against that connector's schema at apply, not at parse.
- `reconcileSchedule`, when a string, must be a 5-field cron. Pass `false` to switch the pass off.
- An agent's `connectorSources:` entries name these slugs.
- No credentials in the file. Retrieval settings such as embedding and rerank models are environment-level (`VOCION_EMBEDDING_MODEL`, `VOCION_RERANK_MODEL`), not per-source YAML.

## Related

[Agent](./agent.md) · [Workflow](./workflow.md) (the `sync` step) · [Object type](./object-type.md)
