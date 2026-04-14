# Plugin SDK (v0.1)

Plugins are the executable counterpart to context-as-code. A **prompt skill** (Phase 1) is YAML + `prompt.md` — CoreContext runs the LLM for you. A **plugin skill** (Phase 3) is a typed TypeScript module where *you* do the work: custom logic, multi-step pipelines, external API calls, structured output.

Both kinds coexist. The same `runtime_run_skill` MCP tool runs either; the same `skill_run` table records either. If a plugin registers a skill with the same slug as a prompt skill, **the plugin wins** — a clean upgrade path with zero migration.

**Status:** v0.1. In-tree types at `src/libs/plugins/`. v0.2 extracts them to `@corecontext/sdk`.

## When to write a plugin

Write a plugin when your skill needs any of:

- **Deterministic pre- or post-processing** — chunk a long transcript, dedupe hits, format JSON output
- **Multiple LLM calls** — summary pass → extract-entities pass → verify pass
- **External API calls** — HubSpot, Stripe, Google Calendar, arbitrary HTTP
- **Structured typed output** — not just text (a prompt skill returns whatever the LLM produces)
- **Input/output validation** — Zod enforced both sides
- **Custom UI** — your own review card component (v0.2)

Write a prompt skill when:

- One LLM call with a template is enough
- Non-developers should own the prompt (markdown is easier than TS)
- Iteration speed matters more than sophistication

## Contract

```ts
import type { PluginManifest } from '@/libs/plugins';
import { z } from 'zod';
import { defineSkill } from '@/libs/plugins';

const Input = z.object({
  transcript: z.string(),
  max_highlights: z.number().int().positive().default(5),
});

const Output = z.object({
  highlights: z.array(z.object({
    theme: z.string(),
    quote: z.string(),
    importance: z.enum(['critical', 'high', 'normal']),
  })),
});

const mySkill = defineSkill({
  slug: 'transcript_highlights',
  name: 'Transcript Highlights',
  description: 'Extract themed highlights from a long transcript.',
  version: '0.1.0',
  category: 'query', // query | mutation | composite
  requiresApproval: false, // true → skill_run.status = pending
  inputSchema: Input,
  outputSchema: Output,
  async run(ctx, input) {
    // ctx.orgId, ctx.openai, ctx.contextSha, ctx.log, ctx.retrieve
    // Your logic here. Throw on error. Return shape must satisfy Output.
    return { highlights: [] };
  },
});

export const manifest: PluginManifest = {
  id: 'acme.transcript-tools',
  version: '0.1.0',
  description: 'Acme transcript skills for CoreContext.',
  skills: [mySkill],
};

export default manifest;
```

### The `PluginContext` handed to `run`

| Field | Purpose |
|---|---|
| `orgId` | Clerk org — scope any multi-tenant data |
| `openai` | Shared OpenAI client (already rate-limited + traced) |
| `contextSha` | Active context SHA, stamped on `skill_run` for audit |
| `invokedBy` | `userId`, `'mcp'`, `'scheduled'`, etc. |
| `log(level, msg, fields?)` | Structured log → goes to Langfuse trace |
| `retrieve(query, {sources?, k?})` | Run retrieval via the platform's configured backend (Onyx today, pgvector Phase 5). Don't call Onyx directly — the wrapper applies your org's `retrieval.yaml` config. |

### Manifest shapes — eager vs lazy

**Eager** — plugin declares a static list:

```ts
export default {
  id: 'acme.tools',
  version: '1.0.0',
  skills: [mySkill, anotherSkill],
};
```

**Lazy** — plugin exports a `register(env)` factory that returns skills at boot:

```ts
export default {
  id: 'acme.dynamic',
  version: '1.0.0',
  register(env) {
    const apiKey = env.env.ACME_API_KEY;
    if (!apiKey) {
      return [];
    }
    return [buildSkillForOrg(env.orgId, apiKey)];
  },
};
```

Use the factory form when a plugin needs env/config read at boot (per-org, per-deployment).

## Installation

Plugins are discovered via the `CORECONTEXT_PLUGINS` env var — comma-separated module specifiers.

```bash
# Local path (absolute or relative to cwd)
export CORECONTEXT_PLUGINS=./src/plugins/samples/transcript-highlights.ts

# Published npm package
export CORECONTEXT_PLUGINS=@acme/corecontext-transcript-tools

# Multiple, comma-separated
export CORECONTEXT_PLUGINS=./local-plugin.ts,@acme/plugin-a,@metacto/plugin-b
```

Add to the MCP client config alongside `DATABASE_URL` and `OPENAI_API_KEY`:

```json
{
  "mcpServers": {
    "corecontext": {
      "command": "npm",
      "args": ["--prefix", "/abs/path/to/context-stack", "run", "mcp:serve"],
      "env": {
        "CORECONTEXT_ORG_ID": "org_...",
        "CORECONTEXT_PLUGINS": "./src/plugins/samples/transcript-highlights.ts"
      }
    }
  }
}
```

## MCP plugin tools

| Tool | Purpose |
|---|---|
| `plugins_list` | Every registered plugin + its skills (slug, version, requiresApproval) |
| `plugins_reload` | Clear registry + re-import every specifier. Dev only — Node ESM caches imports so edits to local files may need a server restart |

## Execution flow

1. Client calls `runtime_run_skill { skill_slug, input }`
2. `SkillService.executeSkill` checks `pluginRegistry.getSkill(slug)`
3. Plugin found → **plugin path**:
   - `inputSchema.parse(input)` — throws on bad input
   - Build `PluginContext`
   - Open Langfuse trace
   - Call `plugin.run(ctx, input)`
   - `outputSchema.parse(output)` — throws on bad output
   - Upsert a lightweight `skill` row (so `skill_run.skill_id` FK is satisfied)
   - Insert `skill_run` (status `pending` if `requiresApproval`, else `auto`)
4. No plugin → **prompt path**: interpolate DB `prompt_template`, call OpenAI, persist (Phase 1 behavior, unchanged)

Both paths produce a `skill_run` with `context_sha`, Langfuse trace id, and approval status. The review queue doesn't care which path produced a draft.

## Error isolation

Each plugin specifier is imported and validated independently. A bad plugin:

- **Missing manifest** → skipped, error logged to `loadPlugins().errors`
- **Manifest validation fails** → skipped, others still load
- **Skill validation fails** → that skill is skipped, others in the plugin still register
- **Thrown error in `run()`** → surfaces to the MCP caller with the error message; the Langfuse trace is updated with the error

Plugins run in-process (no sandboxing). We'll add `vm2`/`isolated-vm` isolation in Phase 3.5+ once third-party plugins ship to managed cloud.

## Evals

Ship Zod-asserted fixtures next to your plugin file (Phase 3 v0.2 — not yet wired):

```ts
// my-skill.test.ts
import mySkill from './my-skill';

describe('mySkill', () => {
  it('extracts highlights from sample transcript', async () => {
    const output = await mySkill.run(mockContext, {
      transcript: readFixture('sample.txt'),
      max_highlights: 5,
    });

    expect(output.highlights).toHaveLength(5);
    expect(output.highlights[0].importance).toBe('critical');
  });
});
```

## Reference: `transcript_highlights` sample

See `src/plugins/samples/transcript-highlights.ts`. Demonstrates:

- Input/output Zod schemas
- Pre-processing (chunking long transcripts)
- Conditional per-chunk LLM calls with `response_format: json_object`
- Post-processing (dedupe, sort, clip)
- Structured logging via `ctx.log`
- Typed structured output

Enable it:

```bash
export CORECONTEXT_PLUGINS=./src/plugins/samples/transcript-highlights.ts
npm run mcp:serve
```

Then from Claude Code: *"run the transcript_highlights skill on the last discovery call — focus on budget."*

## Versioning + conflict rules

- `Skill.version` is plugin-side semver (separate from prompt skill `version` in DB)
- If plugin slug matches a DB prompt slug → plugin wins
- If two plugins register the same slug → last-registered wins (and a warning logs). Load order follows the `CORECONTEXT_PLUGINS` env order.
- Unregistering is restart only (v0.1). `plugins_reload` clears + re-imports.

## Roadmap

- **v0.1** (here) — Skill contract, loader, registry, dual-path execution, sample plugin
- **v0.2** — Separate npm package `@corecontext/sdk`, Source contract for connectors, review UI components, eval harness wired to CI
- **v0.3** — `plugins.yaml` in `context/<org>/` for declarative enablement + config, sandboxing for cloud deployments
- **v1.0** — Public SDK, plugin marketplace registry, signing + permission scopes (Phase 8)
