# Workspaces (workspace-as-code)

A workspace holds **git-backed, version-controlled context** for one tenant of Vocion: agent prompts, skills, playbooks, workflow definitions, business object types, and classification rules. It's the "what Vocion knows about your business" layer, kept out of the database so it can be reviewed in PRs, diffed across versions, and owned by the client.

Workspaces live **outside this repo**, at the peer level of the vocion-core checkout. When vocion-core is a submodule of a deployment repo, workspaces sit beside it:

```
<deployment-repo>/
├── vocion-core/              # this repo (submodule)
└── workspace/
    ├── <tenant-a>/
    └── <tenant-b>/
```

The app finds the active workspace via the `WORKSPACE_PATH` env var (absolute or repo-root-relative). With `WORKSPACE_PATH` unset, no workspace is configured: reads show empty state, and `workspace:apply` / file writes fail with an explicit error.

## Creating a workspace

```bash
npm run workspace:scaffold -- <name>          # creates ../workspace/<name>
npm run workspace:scaffold -- <name> --path <dir>   # custom destination
```

The scaffold is minimal-but-valid — `workspace:check` passes on it as-is. It generates a `workspace.yaml` manifest, the primitive directories, and a README with tenant-facing authoring instructions.

## Why workspace-as-code

Before: prompts + business object schemas + agent config lived in TypeScript seed scripts (`seed-*.ts`, `update-*.ts`). Every tweak to a sender's email voice or an agent's system prompt was a code change buried in a PR, invisible to the rest of the team.

Now: prompts are markdown, config is YAML, and every edit is reviewable like any other doc change. The runtime state (tool calls, approvals, drafts) stays in the database where it belongs.

## Layout

```
<workspace-dir>/
├── workspace.yaml                # manifest: orgId, name, lead, defaults, base-pack pin
├── trust.yaml                    # which actions may auto-execute, and above what confidence
├── agents/
│   ├── <agent>.yaml              # agent metadata + refs
│   └── <agent>.system-prompt.md  # long-form system prompt
├── teams/
│   └── <team>.yaml               # slug comes from the FILENAME; lead + accountable human
├── skills/                       # the deepagents unit — read on the model's judgement
│   └── <slug>/SKILL.md           # YAML frontmatter + markdown procedure
├── playbooks/
│   └── <slug>/SKILL.md           # context attached to a skill or an agent by name
├── missions/                     # YAML — standing responsibilities (goal, autonomy)
├── workflows/
│   └── <slug>/workflow.yaml      # deterministic steps with approve/ask gates
├── automations/                  # YAML — the only place time + events live
├── objects/
│   └── <type-slug>/
│       ├── type.yaml             # schema, source relevance, icon
│       └── classification-prompt.md
├── sources/                      # YAML — connector definitions (no credentials!)
├── learnings/                    # whitelisted rule-step buckets
├── evals/                        # YAML — per-agent test cases for `npm run eval:run`
└── pages/                        # optional tenant dashboard pages (file-only, see below)
```

**Every field of every file type** is documented one page per entity in
[`docs/entities/`](./entities/) — start at the [docs index](./README.md).
Workspace pages have their own guide: [`docs/workspace-pages.md`](./workspace-pages.md).

**Slugs:** lowercase, alphanumeric, dashes/underscores only, start with a letter. The directory name and the frontmatter `slug` both use dashes (`draft-followup-email`).

## Authoring

### Add a new skill

1. Create `skills/<my-skill>/SKILL.md` in your workspace:
   ```markdown
   ---
   slug: my-skill
   name: My Skill
   description: >-
     One line the agent reads to decide when this skill is relevant.
   playbooks: [house-style]   # optional — playbooks that travel with this skill
   version: 1
   ---

   # My Skill

   The procedure, the rules, and the output contract, in markdown.
   ```
2. Name it on each agent that should mount it (`skills:` in the agent YAML).
   A skill activates on the model's judgement; where the work must happen
   every time, name the skill outright in the mission or automation prompt.
3. `npm run workspace:check -- <path>` — validates without writing
4. `npm run workspace:apply -- <path> --project <id|slug>` — writes to DB

### Attach a playbook

A playbook is the same SKILL.md folder shape under `playbooks/`. It mounts
by NAME, never by tag:

- name it on a skill (`playbooks:` in the skill's frontmatter) and it
  travels wherever that skill is switched on, or
- name it on an agent (`playbooks:` in the agent YAML) for context that
  should always be present for that agent.

`workspace:check` fails on a playbook reference that resolves to nothing.

### Add a new object type

```yaml
# objects/my-type/type.yaml
slug: my_type
label: My Type
description: Brief description
icon: phone # lucide icon name
classificationPromptFile: classification-prompt.md
schema:
  type: object
  properties:
    field_1: {type: string}
sourceRelevance: # higher = more relevant for this type
  zoom: 2.0
  gmail: 1.0
fewShotExamples:
  - input: example input
    output: example output
    label: what makes this a good example
```

### Edit an agent's system prompt

Open `agents/<agent>.system-prompt.md` in the workspace, edit, save, re-apply. The agent uses the new prompt on the next request.

## Base packs — activate + extend (`extends` / `use` / `disable`)

A **base pack** is a versioned, reusable layer that ships *inside* vocion-core (at `packages/core/templates/base/`) and holds default RevOps agents plus the skills and playbooks they need. A workspace opts into it, activates the pieces it wants, and overrides any of them — all in YAML. Nothing here is required: **omit `extends` and your workspace loads exactly as before, byte-for-byte.**

The three verbs, all in `workspace.yaml` — the *only* place activation happens:

```yaml
# workspace.yaml
extends: core@2.0.0 # pin the base pack. OMIT → no base layer at all.
use: # activate AGENTS; their skills + object types + the
  agents: [revenue-director, proposal-writer] # skills' playbooks come along transitively
  skills: [lead-triage] # a base skill no activated agent mounts
  playbooks: [warming-etiquette] # standalone base context
  # …or `use: all` to take every default the pack ships
  # …or omit `use` entirely (with `extends` set) = activate nothing
disable: # optional: suppress a default even under `use: all`
  agents: [some_core_default]
```

- **Activate agents first.** An agent declares `skills:`, so activating it pulls those skills (their attached playbooks, and the object types it uses) in automatically. `use.skills` / `use.playbooks` cover the stragglers.
- **`use` omitted while `extends` is set = `use: none`** — explicit opt-in, no surprise agents.
- **Pin, don't float.** A workspace moves onto a new pack version only by bumping its own `extends` pin; publishing a newer pack never silently reaches a pinned instance. The pinned version folds into `workspace_sha`.

### Override a base default (`extends: core`)

A resource file is **optional** — write one *only* to change an activated default. If the core default is fine, activate it and write no file. To override, drop a same-slug file marked `extends: core`:

```yaml
# agents/proposal-writer.yaml — patch the core default
extends: core # REQUIRED marker; without it a colliding slug is an error
slug: proposal-writer # must match the base slug you're patching
systemPromptFile: ./proposal-writer.system-prompt.md # scalar → replaces the base value
connectorSources: {$append: [slack]} # array → extend the base list
# every field you don't mention is inherited from the base unchanged
```

Merge vocabulary (YAML kinds — agents, objects, missions):

- **Scalars & objects** (`model`, `systemPromptFile`, `searchConfig`) → your value **replaces** the base value.
- **Arrays** (`skills`, `connectorSources`, `objectTypes`) → default **replace**; opt into extend semantics with `{ $append: [x] }` or `{ $remove: [y] }`.

**Skills and playbooks override differently**: a workspace SKILL.md with the
same slug as an activated base one replaces it OUTRIGHT (whole-file replace,
no merge, no `extends` marker), with sibling resources merged by path (the
workspace file wins where both ship the same relative path).

Guardrails (all caught by `workspace:check`, not just apply):

- A slug that collides with a base default the workspace has not activated is a hard error.
- For YAML kinds, a colliding slug **without** `extends: core` is a hard error — declare intent (override) or rename.
- `use:` naming a slug the pack does not ship is a hard error.
- An agent or skill reference that resolves to nothing (an agent's `skills:`/`playbooks:` entry, or a skill's `playbooks:` entry) is a hard error.
- Approval lives with ACTIONS (`propose_action` + the review queue), not with skill definitions — a skill can never grant itself sending rights.

### Seeing what you inherited

On any drilldown (`/dashboard/agents/<slug>` etc.), the inherited base file appears as a read-only tab tagged **core**; your workspace override sits alongside it, editable. A purely inherited default shows the **core** layer alone.

## Commands

All run from the vocion-core checkout and take the workspace path as an argument (or read `WORKSPACE_PATH`):

| Command | What it does |
|---|---|
| `npm run workspace:scaffold -- <name>` | Creates a new minimal-but-valid workspace at `../workspace/<name>`. |
| `npm run workspace:check -- <path>` | Validates every YAML + MD file. Shows what would change. No DB writes. |
| `npm run workspace:apply -- <path> --project <id\|slug>` | Writes changes to DB. Records a `workspace_version` row with the git SHA + diff summary. |
| `npm run workspace:export` | Reads current DB rows into a directory. Use to bootstrap a new tenant from existing DB state. |

Check/apply/export honor `WORKSPACE_PATH` and `SEED_ORG_ID` env vars. Flags:
- `--dry-run` — validate + diff only
- `--project <id|slug>` — apply under this project's id (recommended — no re-key)
- `--org <orgId>` — override the `orgId` in the manifest (advanced / back-compat)
- `--applied-by <name>` — who triggered this apply (default: `$USER`)

## Audit trail

Every `workspace:apply` records a row in `workspace_version` (git SHA, applied_at, files, per-resource counts, applied_by). Every `tool_call` stamps `workspace_sha` — so six months from now, "why did the agent draft the email like that?" is answerable by:

```sql
SELECT tc.agent_slug, tc.tool, tc.input, tc.output, tc.workspace_sha, tc.created_at
FROM tool_call tc
WHERE tc.id = <row_id>;

-- then `git show <workspace_sha>` in the workspace's repo to see the exact
-- prompts + skills active at the moment the call ran.
```

How to read a `workspace_sha`:

| Shape | Meaning |
|---|---|
| `<git sha>` | Clean apply — the workspace had no uncommitted changes. |
| `<git sha>-dirty-<hash>` | The apply happened with uncommitted changes; the hash covers every loaded file. |
| `local-<hash>` | The workspace is not in a git repo (or git could not be read) — content hash only. |
| `…+core@<version>` | A base pack was pinned. The suffix is appended to any of the above, so the same files on two pack versions stay distinguishable. |

## Validation rules

- Every `SKILL.md` (skill or playbook) must carry YAML frontmatter with `slug`, `name`, and `description`.
- Every `agents/<slug>.yaml` must have either `systemPromptFile` or inline `systemPrompt`.
- The agent hierarchy is one level deep: `parent` must name an agent that has no `parent` of its own, and never the agent itself. The deprecated `role` field, if authored, must match the value derived from `parent`.
- A team's `lead`, an agent's `team`, the manifest's `lead`, an automation's or workflow's owning `agent`, and an automation's `do.workflow` / `do.checkMission` must all resolve inside the workspace.
- Slugs must be unique within each resource type.
- Every YAML file is validated by its Zod schema; a wrong type, a missing required field, or a bad slug fails the load with the file path and the reason.
- Unknown fields are **stripped, not rejected** — schemas are plain `z.object`, so a typo'd key is silently ignored rather than reported. Check the field name against [`docs/entities/`](./entities/) when a setting appears to have no effect.
- Applies are idempotent and atomic per resource: a validation failure in one resource doesn't block the rest.

## What does NOT live in a workspace

- **Runtime state** — tool calls, drafts, approvals, business object instances, user data. That's DB only.
- **Secrets** — API keys, OAuth tokens. Use `.env` or a secrets manager; connector credentials live encrypted in the runtime's vault, attached to the source after apply.
- **Per-instance business objects** — the *definition* of a Discovery Call is context; a specific discovery call is runtime data (created via the UI).
