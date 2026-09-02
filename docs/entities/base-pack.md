# Base pack — `pack.yaml`

A base pack is a versioned, reusable layer that ships *inside* vocion-core and
loads *underneath* a workspace. It holds default agents plus the skills and
playbooks they need, authored exactly like a workspace so the loader reuses the
same walk, the same schemas, and the same validation.

A pack is composed at load time, every load. That makes it different from the
sample workspaces in `packages/core/templates/workspaces/`, which are copied
into an empty organization once and then belong to the tenant.

| | |
|---|---|
| **Path** | `packages/core/templates/<name>/pack.yaml` (today only `base/`, named `core`) |
| **Schema** | `PackManifestSchema` — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | Nothing. A pack is never written to the database; it composes at load. |
| **Layering** | It *is* the lower layer |

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `name` | `core` | yes | Pack identity. Only `core` exists today. |
| `version` | semver `x.y.z` | yes | The version a workspace pins with `extends: core@<version>`, and the value folded into `workspace_sha`. |
| `description` | string | no | What the pack contains. |

## Example

```yaml
name: core
version: 2.0.0
description: Reusable RevOps base pack — agents, skills, and playbooks.
```

## What a pack may contain

Authored with the same folder shapes as a workspace:

- `agents/<slug>.yaml`
- `skills/<slug>/SKILL.md`
- `playbooks/<slug>/SKILL.md`
- `missions/<slug>.yaml`
- `objects/<slug>/type.yaml`

Those five kinds are the composable ones. Teams, workflows, automations,
sources, learnings, evals, and trust rules are workspace-only — a pack does not
supply them.

## Activation

Activation happens only in the workspace's `workspace.yaml`, never in the pack:

```yaml
extends: core@2.0.0 # pin the pack; omit for no base layer
use: # activate agents; their dependencies come along
  agents: [revenue-director]
  skills: [lead-triage] # a base skill no activated agent mounts
  playbooks: [warming-etiquette] # standalone base context
disable:
  agents: [some-core-default]
```

- **Activation is agent-rooted.** Naming an agent pulls in the skills it declares in `skills:`, the object types in `objectTypes:`, and the playbooks in `playbooks:`. An activated skill also drags along the playbooks in its own frontmatter. You never hand-list an agent's own skills.
- `use: all` takes every default the pack ships.
- Omitting `use` while `extends` is set activates nothing — explicit opt-in, no surprise agents.
- `disable` removes a slug from the activated set even under `use: all`.
- **Pin, don't float.** Publishing a newer pack never reaches a pinned workspace; the workspace moves by editing its own pin.

## Overriding a default

Per slug, the loader resolves one of five outcomes:

| Situation | Result |
|---|---|
| Base activated, no workspace file | `origin: core` — you get the pack's version |
| Workspace file, no base twin | `origin: workspace` |
| Workspace file marked `extends: core`, base twin activated | deep merge → `origin: merged` |
| Workspace file collides with a base twin, no `extends: core` | hard error — declare intent or rename |
| Workspace file marked `extends: core`, base twin *not* activated | hard error — activate it first |

Merge semantics for YAML kinds (agents, object types, missions):

- Scalars and objects (`model`, `systemPromptFile`, `searchConfig`) — your value replaces the base value.
- Arrays (`skills`, `connectorSources`, `objectTypes`) — replace by default; use `{$append: [x]}` or `{$remove: [y]}` to extend the base list instead.

Skills and playbooks fold differently: a workspace `SKILL.md` with an activated
base slug replaces the base file outright, with no merge and no `extends`
marker. Sibling resource files are merged by relative path, and the workspace
copy wins where both ship the same path.

The merge runs on raw YAML *before* validation, so an override file may be a
fragment or carry a directive; the merged result is validated by the normal
schema afterwards.

## Related

[Workspace manifest](./workspace-manifest.md) · [Agent](./agent.md) · [authoring guide](../workspace.md)
