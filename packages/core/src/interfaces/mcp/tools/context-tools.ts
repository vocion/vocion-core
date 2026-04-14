import type { McpConfig } from '../config';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  AgentManifestSchema,
  applyContext,
  autoCommit,
  ContextValidationError,
  deleteResource,
  loadContext,
  ObjectTypeManifestSchema,
  SkillManifestSchema,
  writeAgent,
  writeObjectType,
  writeSkill,
} from '@/libs/context';
import { db } from '@/libs/DB';
import { agentSchema, businessObjectTypeSchema, contextVersionSchema, skillSchema } from '@/models/Schema';

/**
 * Context-as-code tools for the MCP server.
 *
 * Every write_* tool runs the full loop (write files → auto-commit → apply),
 * so the caller gets one atomic response: files written, new git SHA,
 * and per-resource diff counts. On validation failure, nothing is applied.
 */

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function contextTools(config: McpConfig): ToolModule[] {
  return [
    listTool(config),
    getTool(config),
    writeSkillTool(config),
    writeAgentTool(config),
    writeObjectTypeTool(config),
    deleteTool(config),
    applyTool(config),
    diffTool(config),
    versionHistoryTool(config),
  ];
}

function listTool(config: McpConfig): ToolModule {
  return {
    name: 'context_list',
    title: 'List all context resources',
    description: 'List every agent, skill, and object type defined in the active context directory. Returns slugs, names, and descriptions — not full prompts.',
    inputSchema: {},
    handler: async () => {
      const loaded = loadContext(config.contextPath);
      return {
        sha: loaded.sha,
        orgId: loaded.manifest.orgId,
        agents: loaded.agents.map(a => ({ slug: a.slug, name: a.name, description: a.description, skills: a.skills, objectTypes: a.objectTypes })),
        skills: loaded.skills.map(s => ({ slug: s.slug, name: s.name, description: s.description, status: s.status, category: s.category, version: s.version })),
        objectTypes: loaded.objectTypes.map(o => ({ slug: o.slug, label: o.label, description: o.description })),
      };
    },
  };
}

function getTool(config: McpConfig): ToolModule {
  return {
    name: 'context_get',
    title: 'Get full detail of one context resource',
    description: 'Return the full manifest (including prompt text) for one agent, skill, or object type. Use after context_list to pick the slug.',
    inputSchema: {
      kind: z.enum(['agent', 'skill', 'object_type']).describe('which resource family'),
      slug: z.string().describe('the slug of the resource'),
    },
    handler: async (input) => {
      const { kind, slug } = input as { kind: 'agent' | 'skill' | 'object_type'; slug: string };
      const loaded = loadContext(config.contextPath);
      if (kind === 'agent') {
        const a = loaded.agents.find(x => x.slug === slug);
        if (!a) {
          return { error: `agent "${slug}" not found` };
        }
        return { ...a };
      }
      if (kind === 'skill') {
        const s = loaded.skills.find(x => x.slug === slug);
        if (!s) {
          return { error: `skill "${slug}" not found` };
        }
        return { ...s };
      }
      const o = loaded.objectTypes.find(x => x.slug === slug);
      if (!o) {
        return { error: `object_type "${slug}" not found` };
      }
      return { ...o };
    },
  };
}

function writeSkillTool(config: McpConfig): ToolModule {
  return {
    name: 'context_write_skill',
    title: 'Create or update a skill',
    description: 'Write a skill manifest + prompt to context/<org>/skills/. Writes to disk + auto-applies to DB. Git is external — pass autoCommit=true to opt in. Returns files written, new context SHA, and the apply diff.',
    inputSchema: {
      manifest: toolShape(SkillManifestSchema, ['promptFile']),
      prompt_md: z.string().describe('the prompt template — supports {{variables}}'),
      autoApply: z.boolean().default(true).describe('apply to DB after writing (default true)'),
      autoCommit: z.boolean().default(false).describe('git commit after writing (default false; git is external responsibility)'),
      commitMessage: z.string().optional().describe('override default commit message'),
    },
    handler: async (input) => {
      const parsed = parseWriteInput(input);
      const written = writeSkill({
        contextPath: config.contextPath,
        manifest: parsed.manifest as never,
        promptMd: parsed.prompt_md,
      });
      return runApplyAndCommit(config, written, `update skill ${written.slug}`, parsed);
    },
  };
}

function writeAgentTool(config: McpConfig): ToolModule {
  return {
    name: 'context_write_agent',
    title: 'Create or update an agent',
    description: 'Write an agent manifest + system prompt. Writes to disk + auto-applies to DB. Git is external — pass autoCommit=true to opt in.',
    inputSchema: {
      manifest: toolShape(AgentManifestSchema, ['systemPromptFile']),
      system_prompt_md: z.string().describe('the system prompt'),
      autoApply: z.boolean().default(true),
      autoCommit: z.boolean().default(false),
      commitMessage: z.string().optional(),
    },
    handler: async (input) => {
      const parsed = parseWriteInput(input, 'system_prompt_md');
      const written = writeAgent({
        contextPath: config.contextPath,
        manifest: parsed.manifest as never,
        systemPromptMd: parsed.prompt_md,
      });
      return runApplyAndCommit(config, written, `update agent ${written.slug}`, parsed);
    },
  };
}

function writeObjectTypeTool(config: McpConfig): ToolModule {
  return {
    name: 'context_write_object_type',
    title: 'Create or update a business object type',
    description: 'Write an object type manifest (schema, source relevance, classification prompt). Writes to disk + auto-applies to DB. Git is external — pass autoCommit=true to opt in.',
    inputSchema: {
      manifest: toolShape(ObjectTypeManifestSchema, ['classificationPromptFile']),
      classification_prompt_md: z.string().optional().describe('optional classification prompt'),
      autoApply: z.boolean().default(true),
      autoCommit: z.boolean().default(false),
      commitMessage: z.string().optional(),
    },
    handler: async (input) => {
      const parsed = parseWriteInput(input, 'classification_prompt_md', true);
      const written = writeObjectType({
        contextPath: config.contextPath,
        manifest: parsed.manifest as never,
        classificationPromptMd: parsed.prompt_md || undefined,
      });
      return runApplyAndCommit(config, written, `update object type ${written.slug}`, parsed);
    },
  };
}

function deleteTool(config: McpConfig): ToolModule {
  return {
    name: 'context_delete',
    title: 'Delete a context resource',
    description: 'Remove the files for an agent, skill, or object type from context/<org>/. Auto-commits + auto-applies (which will remove the row from the DB on the next apply).',
    inputSchema: {
      kind: z.enum(['agent', 'skill', 'objectType']),
      slug: z.string(),
      autoApply: z.boolean().default(true),
      autoCommit: z.boolean().default(false),
      commitMessage: z.string().optional(),
    },
    handler: async (input) => {
      const { kind, slug, autoApply, autoCommit: doCommit, commitMessage } = input as {
        kind: 'agent' | 'skill' | 'objectType';
        slug: string;
        autoApply: boolean;
        autoCommit: boolean;
        commitMessage?: string;
      };
      const removed = deleteResource(config.contextPath, kind, slug);
      if (removed.length === 0) {
        return { removed: [], reason: `no files found for ${kind} "${slug}"` };
      }
      const summary = commitMessage ?? `delete ${kind} ${slug}`;
      const commit = doCommit && config.autoCommit ? autoCommit({ contextPath: config.contextPath, summary }) : null;

      // Direct DB delete — apply is reconciliation (upsert), not removal.
      const dbDeleted = (autoApply && config.autoApply)
        ? await deleteFromDb(config.orgId, kind, slug)
        : 0;

      return { removed, commit, dbRowsDeleted: dbDeleted };
    },
  };
}

async function deleteFromDb(orgId: string, kind: 'agent' | 'skill' | 'objectType', slug: string): Promise<number> {
  if (kind === 'agent') {
    const rows = await db.delete(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).returning();
    return rows.length;
  }
  if (kind === 'skill') {
    const rows = await db.delete(skillSchema).where(and(eq(skillSchema.orgId, orgId), eq(skillSchema.slug, slug))).returning();
    return rows.length;
  }
  const rows = await db.delete(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, slug))).returning();
  return rows.length;
}

function applyTool(config: McpConfig): ToolModule {
  return {
    name: 'context_apply',
    title: 'Apply pending context to the DB',
    description: 'Reconcile context/<org>/ to the database and record a context_version audit row. Use after editing files directly (outside MCP) or when auto-apply was disabled.',
    inputSchema: {
      dryRun: z.boolean().default(false).describe('validate + diff only, no writes'),
    },
    handler: async (input) => {
      return applyNow(config, (input as { dryRun?: boolean }).dryRun ?? false);
    },
  };
}

function diffTool(config: McpConfig): ToolModule {
  return {
    name: 'context_diff',
    title: 'Show pending context changes',
    description: 'Dry-run apply — shows created/updated/unchanged counts without writing. Equivalent to `context_apply dryRun=true`.',
    inputSchema: {},
    handler: async () => applyNow(config, true),
  };
}

function versionHistoryTool(config: McpConfig): ToolModule {
  return {
    name: 'context_version_history',
    title: 'List recent context applies',
    description: 'Show the last N context_version rows: sha, summary, applied_by, applied_at. Useful for answering "when did this prompt last change?"',
    inputSchema: {
      limit: z.number().int().positive().max(100).default(20),
    },
    handler: async (input) => {
      const { limit } = input as { limit: number };
      const rows = await db
        .select()
        .from(contextVersionSchema)
        .where(eq(contextVersionSchema.orgId, config.orgId))
        .orderBy(desc(contextVersionSchema.appliedAt))
        .limit(limit);
      return rows.map(r => ({
        id: r.id,
        sha: r.sha,
        appliedAt: r.appliedAt,
        appliedBy: r.appliedBy,
        status: r.status,
        summary: r.summary,
        errors: r.errors,
      }));
    },
  };
}

// helpers --------------------------------------------------------------------

type ParsedWriteInput = {
  manifest: Record<string, unknown>;
  prompt_md: string;
  autoApply: boolean;
  autoCommit: boolean;
  commitMessage?: string;
};

function parseWriteInput(input: Record<string, unknown>, promptKey = 'prompt_md', optional = false): ParsedWriteInput {
  const manifest = input.manifest as Record<string, unknown> | undefined;
  if (!manifest) {
    throw new Error('manifest is required');
  }
  const prompt = input[promptKey];
  if (!optional && typeof prompt !== 'string') {
    throw new Error(`${promptKey} is required`);
  }
  return {
    manifest,
    prompt_md: (prompt as string | undefined) ?? '',
    autoApply: (input.autoApply as boolean | undefined) ?? true,
    autoCommit: (input.autoCommit as boolean | undefined) ?? true,
    commitMessage: input.commitMessage as string | undefined,
  };
}

async function runApplyAndCommit(config: McpConfig, written: { slug: string; files: string[] }, defaultSummary: string, opts: ParsedWriteInput) {
  const commit = opts.autoCommit && config.autoCommit
    ? autoCommit({ contextPath: config.contextPath, summary: opts.commitMessage ?? defaultSummary })
    : null;
  const apply = opts.autoApply && config.autoApply ? await applyNow(config) : null;
  return { written, commit, apply };
}

async function applyNow(config: McpConfig, dryRun = false) {
  try {
    const loaded = loadContext(config.contextPath);
    const result = await applyContext(loaded, { orgId: config.orgId, dryRun, appliedBy: 'mcp' });
    return result;
  } catch (err) {
    if (err instanceof ContextValidationError) {
      return { error: err.message, file: err.file, kind: err.kind, issues: err.issues };
    }
    throw err;
  }
}

/**
 * Relaxed manifest input shape for MCP tools. Real validation happens inside
 * the writer against the strict Zod schemas — we don't try to re-derive
 * JSON Schema from refined Zod schemas here (Zod 4 + MCP derivation has
 * rough edges with .refine()).
 * @param _schema
 * @param stripFields
 */
function toolShape(_schema: unknown, stripFields: string[]): z.ZodType {
  return z.record(z.string(), z.unknown()).describe(
    `manifest object — omit ${stripFields.join(', ')} (writer sets them from disk layout). Full schema in src/libs/context/schemas.ts.`,
  );
}
