# acme-revops workspace

Git-backed, version-controlled context for the `acme-revops` tenant: agent
definitions, operations (typed LLM calls), playbooks, workflows, missions,
object types, sources, automations, and learnings. Authored as YAML +
markdown, applied to the running platform's database — editing files here
changes nothing until re-applied.

## Layout

```
acme-revops/
├── workspace.yaml   # manifest: orgId placeholder, name, model defaults
├── agents/          # <agent>.yaml (+ <agent>.system-prompt.md)
├── operations/      # <slug>/skill.yaml + prompt.md
├── playbooks/       # <slug>/SKILL.md (+ sibling resources)
├── workflows/       # <slug>.yaml — sequential steps with approve gates
├── missions/        # <slug>.yaml — recurring team objectives
├── objects/         # <slug>/type.yaml — business object type definitions
├── sources/         # <slug>.yaml — connector definitions (no credentials!)
├── automations/     # <slug>.yaml
└── learnings/       # rule-step buckets
```

## Example agent

```yaml
# agents/example-assistant.yaml
slug: example_assistant
name: Example Assistant
description: What this agent is for.
active: true
systemPromptFile: example-assistant.system-prompt.md
```

## Applying

Validate, then sync to the database (from the vocion-core checkout):

```bash
npm run workspace:check -- demo/workspace
npm run workspace:apply -- demo/workspace --project <id|slug>
```

Long-running deployments should set `WORKSPACE_PATH=demo/workspace` so the
app (dashboard file views, playbook mounts, postprocess scripts) reads
from this directory.

Every apply records a `workspace_version` row; every run stamps the
active `workspace_sha` so outputs trace back to the exact prompts that
produced them. See `docs/workspace.md` in vocion-core for authoring
reference and validation rules.
