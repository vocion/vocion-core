# Client Context

This directory holds **git-backed, version-controlled context** for each tenant of Vocion: agent prompts, skill definitions, business object types, and classification rules. It's the "what Vocion knows about your business" layer, kept out of the database so it can be reviewed in PRs, diffed across versions, and owned by the client.

## Why workspace-as-code

Before: prompts + business object schemas + agent config lived in TypeScript seed scripts (`seed-*.ts`, `update-*.ts`). Every tweak to a sender's email voice or an agent's system prompt was a code change buried in a PR, invisible to the rest of the team.

Now: prompts are markdown, config is YAML, and every edit is reviewable like any other doc change. The runtime state (skill runs, approvals, drafts) stays in the database where it belongs.

See the Phase 1 section of the root `README.md` for the full roadmap.

## Layout

```
workspace/
└── <org-name>/                       # one directory per tenant
    ├── workspace.yaml                  # manifest: orgId, name, defaults
    ├── agents/
    │   ├── <agent>.yaml              # agent metadata + refs
    │   └── <agent>.system-prompt.md  # long-form system prompt
    ├── skills/
    │   └── <skill-slug>/
    │       ├── skill.yaml            # metadata, input schema, model
    │       └── prompt.md             # prompt template (with {{vars}})
    └── objects/
        └── <type-slug>/
            ├── type.yaml             # schema, source relevance, icon
            └── classification-prompt.md
```

**Slugs:** lowercase, alphanumeric, dashes/underscores only, start with a letter. The directory name uses dashes (`draft-followup-email`), the YAML `slug` field uses underscores to match the DB convention (`draft_followup_email`).

## Authoring

### Add a new skill

1. Create `skills/<my-skill>/` directory
2. Write `prompt.md` with your template. Use `{{variable}}` for interpolation.
3. Create `skill.yaml`:
   ```yaml
   slug: my_skill
   name: My Skill
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
4. `npm run workspace:check` — validates without writing
5. `npm run workspace:apply` — writes to DB

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

### Edit the Sales Assistant's system prompt

Open `agents/sales-assistant.system-prompt.md`, edit, save, `npm run workspace:apply`. The agent will use the new prompt on the next request.

### Edit the follow-up email operation

Open `operations/draft-followup-email/prompt.md` — the case-study library, voice rules, structure guide, and few-shot examples all live here. Edit as prose.

## Commands

| Command | What it does |
|---|---|
| `npm run workspace:check` | Validates every YAML + MD file. Shows what would change. No DB writes. |
| `npm run workspace:apply` | Writes changes to DB. Records a `workspace_version` row with the git SHA + diff summary. |
| `npm run workspace:export` | (one-time) Reads current DB rows into this directory. Use to bootstrap a new tenant from existing DB state. |

All three honor `WORKSPACE_PATH` and `SEED_ORG_ID` env vars. Flags:
- `--dry-run` — validate + diff only
- `--org <orgId>` — override the `orgId` in the manifest
- `--applied-by <name>` — who triggered this apply (default: `$USER`)

## Audit trail

Every `workspace:apply` records a row in `workspace_version` (git SHA, applied_at, files, per-resource counts, applied_by). Every `skill_run` stamps `workspace_sha` — so six months from now, "why did the agent draft the email like that?" is answerable by:

```sql
SELECT s.name, sr.input, sr.output, sr.workspace_sha, sr.created_at
FROM skill_run sr JOIN skill s ON s.id = sr.skill_id
WHERE sr.id = <run_id>;

-- then `git show <workspace_sha>` on this directory to see the exact prompts + config
-- active at the moment the skill ran.
```

If the SHA is suffixed `-dirty-<hash>`, the apply happened with uncommitted changes. Clean applies only carry the git short SHA.

## Validation rules

- Every `skill.yaml` must have either `promptFile` or inline `promptTemplate`.
- Every `agent.yaml` must have either `systemPromptFile` or inline `systemPrompt`.
- Slugs must be unique within each resource type.
- YAML is strictly validated by Zod — unknown fields are not allowed.
- Applies are idempotent and atomic per resource: a validation failure in one skill doesn't block the rest.

## What does NOT live here

- **Runtime state** — skill runs, drafts, approvals, business object instances, user data. That's DB only.
- **Secrets** — API keys, OAuth tokens. Use `.env` or a secrets manager. The context can reference `${secrets.foo}` (Phase 2).
- **Per-instance business objects** — the *definition* of a Discovery Call is context; the specific discovery call with Dr. K is runtime data (created via `seed-discovery-call.ts` or the UI).

## Moving to a separate repo

This is deliberately in-tree for Phase 1 to keep the dogfood loop tight. When ready (probably Phase 5, alongside OSS release), extract to `metacto-context` or per-client repos via `git subtree split`. The loader already supports an external `WORKSPACE_PATH`, so nothing in core needs to change.
