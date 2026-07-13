# Workspaces (workspace-as-code)

A workspace holds **git-backed, version-controlled context** for one tenant of Vocion: agent prompts, operations, playbooks, workflow definitions, business object types, and classification rules. It's the "what Vocion knows about your business" layer, kept out of the database so it can be reviewed in PRs, diffed across versions, and owned by the client.

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

Now: prompts are markdown, config is YAML, and every edit is reviewable like any other doc change. The runtime state (operation runs, approvals, drafts) stays in the database where it belongs.

## Layout

```
<workspace-dir>/
├── workspace.yaml                # manifest: orgId placeholder, name, defaults
├── agents/
│   ├── <agent>.yaml              # agent metadata + refs
│   └── <agent>.system-prompt.md  # long-form system prompt
├── operations/                   # v0.2: renamed from skills/ (loader reads both)
│   └── <slug>/
│       ├── skill.yaml            # metadata, input schema, model
│       └── prompt.md             # prompt template (with {{vars}})
├── playbooks/
│   └── <slug>/SKILL.md           # markdown + YAML frontmatter procedural guides
├── workflows/                    # YAML — sequential steps with approve gates
├── missions/                     # YAML — recurring team objectives
├── objects/
│   └── <type-slug>/
│       ├── type.yaml             # schema, source relevance, icon
│       └── classification-prompt.md
├── sources/                      # YAML — connector definitions (no credentials!)
├── automations/
└── learnings/                    # whitelisted rule-step buckets
```

**Slugs:** lowercase, alphanumeric, dashes/underscores only, start with a letter. The directory name uses dashes (`draft-followup-email`), the YAML `slug` field uses underscores to match the DB convention (`draft_followup_email`).

## Authoring

### Add a new operation

1. Create `operations/<my-operation>/` in your workspace
2. Write `prompt.md` with your template. Use `{{variable}}` for interpolation.
3. Create `skill.yaml`:
   ```yaml
   slug: my_operation
   name: My Operation
   description: What it does.
   category: query # query | mutation | composite
   status: active # active | disabled | draft
   version: 1
   model: gpt-5.4-mini
   temperature: '0.2'
   requiresApproval: false
   promptFile: prompt.md
   inputSchema:
     type: object
     required: [input_var]
     properties:
       input_var:
         type: string
         description: Description of input
   ```
4. `npm run workspace:check -- <path>` — validates without writing
5. `npm run workspace:apply -- <path> --project <id|slug>` — writes to DB

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

Every `workspace:apply` records a row in `workspace_version` (git SHA, applied_at, files, per-resource counts, applied_by). Every `skill_run` stamps `workspace_sha` — so six months from now, "why did the agent draft the email like that?" is answerable by:

```sql
SELECT s.name, sr.input, sr.output, sr.workspace_sha, sr.created_at
FROM skill_run sr JOIN skill s ON s.id = sr.skill_id
WHERE sr.id = <run_id>;

-- then `git show <workspace_sha>` in the workspace's repo to see the exact
-- prompts + config active at the moment the operation ran.
```

If the SHA is suffixed `-dirty-<hash>`, the apply happened with uncommitted changes. Clean applies only carry the git short SHA.

## Validation rules

- Every `skill.yaml` must have either `promptFile` or inline `promptTemplate`.
- Every `agent.yaml` must have either `systemPromptFile` or inline `systemPrompt`.
- Slugs must be unique within each resource type.
- YAML is strictly validated by Zod — unknown fields are not allowed.
- Applies are idempotent and atomic per resource: a validation failure in one operation doesn't block the rest.

## What does NOT live in a workspace

- **Runtime state** — operation runs, drafts, approvals, business object instances, user data. That's DB only.
- **Secrets** — API keys, OAuth tokens. Use `.env` or a secrets manager; connector credentials live encrypted in the runtime's vault, attached to the source after apply.
- **Per-instance business objects** — the *definition* of a Discovery Call is context; a specific discovery call is runtime data (created via the UI).
