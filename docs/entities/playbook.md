# Playbook — `playbooks/<slug>/SKILL.md`

A playbook is standing context rather than a task: house style, etiquette
rules, a pricing policy. Same folder shape and same frontmatter as a skill,
but it mounts by *attachment* — it rides along with a skill or an agent instead
of being chosen by the model.

| | |
|---|---|
| **Path** | `playbooks/<slug>/SKILL.md`, plus any sibling resource files |
| **Schema** | `PlaybookManifestSchema` (kind `playbook`) — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `playbook` table |
| **Runtime** | Mounted at `/playbooks/<slug>/` when named by a mounted skill's `playbooks:` or by the agent's `playbooks:` |
| **Surface** | `/dashboard/skills`, Playbooks section |
| **Layering** | Composable — a workspace copy replaces an activated base playbook whole-file |
| **No folder** | An app applies its playbooks once as the workspace's own copies (mirror artifacts), edited in place and kept through upgrades — `services/playbooks/owned.ts` |

The filename is `SKILL.md` here too, for the same middleware reason.

## Frontmatter fields

Identical to a [skill](./skill.md): `slug`, `name`, `description` (required),
plus `playbooks`, `version`, `resources`, `license`. The `playbooks` field is
meaningful on skills; on a playbook it is normally left off.

## Example

```markdown
---
slug: warming-etiquette
name: Warming Etiquette
description: >-
  How we approach a cold or dormant contact — cadence, tone, and what
  never to do.
version: 1
---

# Warming Etiquette

Two touches maximum before a reply. Reference something real and recent —
never "just checking in". Anything that leaves the building is a draft for
human approval.
```

## How a playbook gets attached

It mounts by name, never by tag:

- name it on a skill (`playbooks:` in the skill's frontmatter) and it travels wherever that skill is switched on, or
- name it on an agent (`playbooks:` in the agent YAML) for context that should always be present for that agent.

Activating a base-pack skill also activates the playbooks its frontmatter
names, so you rarely list those yourself.

## In a workspace with no folder

A workspace made in the app (every Vocion Cloud workspace) has no
`playbooks/` folder to override in. There, installing an app writes each
playbook it ships once as the workspace's own copy: the playbook's `source`
mirror artifact, the same row a folder workspace edits through. From then on
the mount, `read_playbook` and the skills page read the copy; a person's Save
in the pane, a Restore, and an agent's `write_playbook` (once a person
approves the diff) land on it; and when core ships new templates an upgrade
moves a copy nobody touched and keeps one a person changed, listed as kept on
the version row (`services/playbooks/owned.ts`, `AppBundleRecord.playbooks`).

## Rules

- Frontmatter must carry `slug`, `name`, and `description`.
- Slugs are unique across playbooks.
- A reference that resolves to nothing is a hard error at `workspace:check`.
- Tag matching is gone. `playbook.tags` and `agent.playbookTags` were removed in ADR 0003 in favor of attachment by name.

## Related

[Skill](./skill.md) · [Agent](./agent.md) · ADR: `docs/adr/0003-skill-playbook-operation.md`
