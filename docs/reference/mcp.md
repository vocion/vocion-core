# MCP Server

CoreContext ships a Model Context Protocol server so you can author context, run skills, and inspect the review queue from **any MCP client** — Claude Code, Claude Desktop, Cursor, Zed, Continue. This is the first adapter of the [Phase 2 universal interface layer](../README.md#phase-2--universal-interface-layer-q3-2026).

**Auto-apply is on by default.** Every `write_*` tool writes files to `context/<org>/`, commits to git with a generated message, applies to the DB, and records a `context_version` audit row — all in one atomic call. Override per-call with `autoApply: false` or `autoCommit: false`.

## Install for Claude Code

```bash
claude mcp add corecontext -- npm --prefix /absolute/path/to/context-stack run mcp:serve
```

Or add to `~/.claude/mcp.json` (or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "corecontext": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/context-stack", "run", "mcp:serve"],
      "env": {
        "VOCION_ORG_ID": "org_3B7f6cPKTKnJOExO55asDaUVAay",
        "CONTEXT_PATH": "/absolute/path/to/context-stack/context/metacto"
      }
    }
  }
}
```

Required env:

- `VOCION_ORG_ID` — Clerk org id the server acts on (or fall back to `SEED_ORG_ID`)
- `DATABASE_URL` — Postgres connection string
- `OPENAI_API_KEY` — required only for `runtime_run_skill`

Optional:

- `CONTEXT_PATH` — path to the context directory (default `context/metacto`)
- `CONTEXT_AUTO_COMMIT=false` — disable auto-git globally
- `CONTEXT_AUTO_APPLY=false` — disable auto-apply globally

## Install for Claude Desktop / other clients

Point the client at `tsx src/interfaces/mcp/bin.ts` with the same env. Any stdio-capable MCP client works — the transport is standard.

## Tool reference

### context_*

| Tool | Purpose |
|---|---|
| `context_list` | Every agent/skill/object_type (slug, name, description only) |
| `context_get` | One resource with full prompt text |
| `context_write_skill` | Create or update a skill. Writes `skills/<slug>/{skill.yaml,prompt.md}` → commits → applies |
| `context_write_agent` | Create or update an agent. Writes `agents/<slug>.{yaml,system-prompt.md}` → commits → applies |
| `context_write_object_type` | Create or update an object type (schema + classification prompt) |
| `context_delete` | Remove files + apply (row deletion) |
| `context_apply` | Reconcile files → DB. Use after editing files outside MCP |
| `context_diff` | Dry-run apply. Shows created/updated/unchanged counts |
| `context_version_history` | Recent `context_version` audit rows — "who changed what, when" |

### runtime_*

| Tool | Purpose |
|---|---|
| `runtime_run_skill` | Execute a skill with input. Returns `run_id`, output, Langfuse trace id |
| `runtime_list_runs` | Recent skill runs, filterable by skill slug or status |
| `runtime_get_run` | One full skill run (not truncated) |
| `runtime_approve_draft` | Approve a pending run |
| `runtime_reject_draft` | Reject a pending run (with optional reason) |

### Data access

| Tool | Purpose |
|---|---|
| `objects_list` | List business object instances (filter by type slug) |
| `objects_get` | One object + type + document links |
| `object_types_list` | Discover valid type slugs |
| `search_query` | Run a retrieval query via Onyx. Returns ranked docs with snippets + links |

## Example flows

### Edit the Sales Assistant's system prompt

```
> Use context_get to show me agent sales-assistant, then update it to add a rule
> about always including pricing in discovery summaries. Commit it.
```

Claude Code will call `context_get` with `{kind: 'agent', slug: 'sales-assistant'}`, edit the `systemPrompt` field, then call `context_write_agent` — one commit, one apply, done.

### Test a new skill on real data

```
> Create a skill called objection_summary that reads a discovery transcript
> and lists the top 3 objections the prospect raised. Then run it against
> the last discovery call in my objects.
```

Claude Code will:
1. `context_write_skill` with the new manifest + prompt
2. `objects_list` with `type_slug: 'discovery_call'` to find the latest
3. `runtime_run_skill` with the transcript as input
4. Show you the output and the `run_id` so you can approve/reject

### Review pending drafts

```
> Show me pending skill runs, then approve the email drafts that look good.
```

`runtime_list_runs` → read → `runtime_approve_draft` per selection.

## Auto-apply semantics

Every write goes through this flow atomically:

1. **Validate** the manifest against the Zod schema. Failure aborts with a structured error — nothing touches disk.
2. **Write** YAML + markdown to `context/<org>/<kind>/<slug>/…`
3. **Commit** to git (if `autoCommit` enabled and there are changes). Commit message: `context: <default summary or override>`.
4. **Apply** to the DB (if `autoApply` enabled). Writes a `context_version` row with the new git SHA, diff counts, and `applied_by: 'mcp'`.
5. **Return** `{written, commit, apply}` in one response — the MCP caller sees the new SHA and diff counts without an extra round-trip.

Turn off either leg with `autoCommit: false` / `autoApply: false` per call, or globally with env vars. If git commit fails (hooks, no repo, etc.), the apply is skipped and the caller sees an error — we don't want files on disk that don't match the DB.

## Audit trail

Every `skill_run` stamps `context_sha` with the SHA active at execution time. Every `context_version` records the SHA, per-resource counts, errors, and who applied. To answer "why did the Sales Assistant write that email on April 14?":

```sql
SELECT sr.output, sr.context_sha, sr.created_at, cv.applied_by
FROM skill_run sr
JOIN context_version cv ON cv.sha = sr.context_sha AND cv.org_id = sr.org_id
WHERE sr.id = <run_id>;

-- then: git show <sha> on the context repo for the exact prompts
```

## Limitations (today)

- **stdio transport only.** HTTP+OAuth (for claude.ai, Cursor Cloud, etc.) lands next.
- **Single org per process.** The server is scoped to one `VOCION_ORG_ID`. Multi-tenant HTTP version is Phase 2b.
- **No workflow resource yet.** Workflows (triggers + steps + actions) come in Phase 3 with the conversational bootstrap.
- **Search goes to Onyx.** Phase 5 swaps to native pgvector.

## Extending

Add a new tool in `src/interfaces/mcp/tools/<group>.ts`:

```ts
export function myTool(config: McpConfig): ToolModule {
  return {
    name: 'my_tool',
    title: 'Short title',
    description: 'What it does, shown to the LLM',
    inputSchema: { arg: z.string() },
    handler: async (input) => { /* ... */ },
  };
}
```

Register it in `src/interfaces/mcp/server.ts`. Types flow end-to-end.
