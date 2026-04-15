# Authoring context

Everything you author lives in `context/<org>/` as YAML + markdown. This guide covers the edit + apply loop.

## Directory layout

```
context/<org>/
├── context.yaml                # manifest: orgId, name, optional retrieval overrides
├── sources/<slug>/source.yaml  # connector config (Phase 5)
├── objects/<slug>/
│   ├── type.yaml
│   └── classification-prompt.md
├── skills/<slug>/
│   ├── skill.yaml
│   └── prompt.md
├── workflows/<slug>/workflow.yaml
└── agents/
    ├── <slug>.yaml
    └── <slug>.system-prompt.md
```

## The three commands

```bash
npm run context:check    # validate + diff, no writes
npm run context:apply    # sync to DB; records a context_version audit row
npm run context:export   # bootstrap: dump current DB rows back to context/<org>/
```

`context:apply` is **idempotent** — running it twice is a no-op. It touches only the rows that changed since the last apply.

Every apply bumps `context_version.sha` and every `skill_run` stamps `context_sha` so any output traces back to the exact commit that produced it.

## Editing

### From a text editor

Open the YAML / markdown in your editor, save, `npm run context:apply`. That's it.

### From an MCP client (Claude Code, Cursor, Zed, …)

The MCP server exposes `context_write_skill`, `context_write_agent`, `context_write_object_type`, `context_write_source`, and `context_delete`. These write to disk and call `context:apply` automatically. Git is **not** auto-handled — commit and push yourself.

See [MCP reference](../reference/mcp.md).

### From the dashboard

Drilldown pages (`/dashboard/skills/<slug>`, `/dashboard/agents/<slug>`, …) render the backing YAML + markdown files. Full in-app editing via CodeMirror is on the roadmap.

## Git workflow

Vocion does not commit for you. Your context directory is a normal git repo:

```bash
# after editing + applying
cd context/metacto
git add .
git commit -m "feat(skill): add discovery_summary"
git push
```

The dashboard shows a small **dirty** badge on resource pages when your context repo has uncommitted changes.

## Multi-tenant

Each tenant gets its own `context/<org>/` directory (or, for production, its own git repo — see [extract-tenant](./extract-tenant.md)). Set `CONTEXT_PATH` and `VOCION_ORG_NAME` to point at the tenant you're working on; `context:apply` scopes writes by `orgId` automatically.

## Next

- [Extract a tenant repo](./extract-tenant.md)
- [Writing a plugin](./writing-a-plugin.md) — when context-as-code isn't enough
