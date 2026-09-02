# Skill — `skills/<slug>/SKILL.md`

A skill is a unit of work written for the model to read: YAML frontmatter on
top, then the procedure in Markdown. It is mounted into the agent's virtual
filesystem and read on the model's own judgement — the description line is what
the agent uses to decide whether this skill is relevant at all.

| | |
|---|---|
| **Path** | `skills/<slug>/SKILL.md`, plus any sibling resource files in the same folder |
| **Schema** | `PlaybookManifestSchema` (kind `skill`) — `packages/core/src/libs/workspace/schemas.ts` |
| **Applied to** | `playbook` table (kind, origin, attached playbooks) |
| **Runtime** | Mounted at `/skills/<slug>/` for every agent naming it in `skills:`; lazy-loaded by the deepagents skills middleware |
| **Surface** | `/dashboard/skills`, with usage from `skill_read` rows |
| **Layering** | Composable — a workspace copy replaces an activated base skill whole-file |

The filename must be exactly `SKILL.md`. That is what the deepagents skills
middleware looks for when it lazy-loads on activation. The external concept is
"skill"; the on-disk filename is fixed.

## Frontmatter fields

| Field | Type | Default | What it does |
|---|---|---|---|
| `slug` | slug | required | Stable id. Matches the folder name by convention. |
| `name` | string | required | Human-readable name for the catalog UI. |
| `description` | string | required | The one line the agent reads to decide when to activate this skill. Write it for the model, not for a menu. |
| `playbooks` | string[] | `[]` | Playbook slugs this skill attaches. A playbook named here travels wherever the skill is switched on. |
| `version` | positive int | `1` | Bump when the procedure changes materially. |
| `resources` | string[] | discovered siblings | Sibling files the skill references, e.g. `REFERENCE.md`, `examples/deal.json`. When omitted, every sibling file in the folder is used. |
| `license` | string | — | Free-form license label, e.g. `proprietary`, `Apache-2.0`, `client:metacto`. Surfaced in the catalog so partners can filter or audit. |

Everything after the frontmatter is the skill body — the procedure, the rules,
the output contract — written as if for a smart human collaborator.

## Example

```markdown
---
slug: lead-triage
name: Lead Triage
description: >-
  Triage new inbound leads and unread messages: classify intent, score
  priority, and recommend the next action.
playbooks: [warming-etiquette]
version: 1
---

# Lead Triage

Given recent inbound messages and leads, sort them so the team works the
right ones first.

For each item, return a row:

- **Who / what**: name, company, channel.
- **Intent**: new business, existing client, partner, or noise.
- **Priority**: P0 (hot, time-sensitive), P1, P2.
- **Why**: one line grounded in the message content.
- **Next action**: the single move to make, and who should make it.

Order the list P0 first. Never invent contacts; if a message is ambiguous,
say what is missing rather than guessing intent.
```

## How a skill gets used

1. Name it on each agent that should mount it (`skills:` in the agent YAML).
2. The agent reads it when the model judges it relevant. Where the work must happen every time, name the skill outright in the mission or automation prompt.
3. `npm run workspace:check -- <path>` validates; `npm run workspace:apply -- <path> --project <id|slug>` writes.

## Rules

- Frontmatter must carry `slug`, `name`, and `description`.
- Slugs are unique across skills.
- Every `playbooks:` entry must resolve to a loaded playbook.
- A slug colliding with a base-pack skill the workspace has not activated is a hard error — activate it to override, or rename.
- Overriding an activated base skill is whole-file: your `SKILL.md` replaces theirs, with no field merge and no `extends` marker. Sibling files are merged by relative path and your copy wins on a tie.
- Approval lives with actions (`propose_action` and the review queue), never with a skill definition. A skill can never grant itself sending rights.

## Related

[Playbook](./playbook.md) · [Agent](./agent.md) · [Base pack](./base-pack.md) · ADR: `docs/internal/adr/0003-skill-playbook-operation.md`
