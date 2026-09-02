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

## Rules

- Frontmatter must carry `slug`, `name`, and `description`.
- Slugs are unique across playbooks.
- A reference that resolves to nothing is a hard error at `workspace:check`.
- Tag matching is gone. `playbook.tags` and `agent.playbookTags` were removed in ADR 0003 in favor of attachment by name.

## Related

[Skill](./skill.md) · [Agent](./agent.md) · ADR: `docs/internal/adr/0003-skill-playbook-operation.md`
