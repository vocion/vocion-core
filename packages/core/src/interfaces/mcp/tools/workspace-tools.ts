import type { McpConfig } from '../config';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import {
  AgentManifestSchema,
  applyWorkspace,
  autoCommit,
  deleteResource,
  loadWorkspace,
  MissionManifestSchema,
  ObjectTypeManifestSchema,
  PlaybookManifestSchema,
  WorkspaceValidationError,
  writeAgent,
  writeMission,
  writeObjectType,
  writeSkill,
} from '@/libs/workspace';
import { agentSchema, businessObjectTypeSchema, missionSchema, playbookSchema, workspaceVersionSchema } from '@/models/Schema';
import { PAUSED_CAPABILITIES, pauseWorkspace, resumeWorkspace } from '@/services/workspacePause';

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

export function workspaceTools(config: McpConfig, identity?: { userId: string }): ToolModule[] {
  // Everything below `versionHistoryTool` reads the workspace CHECKOUT at
  // `config.contextPath`. That path is a property of the process, not of the
  // caller, so on a transport where one process serves many orgs it names one
  // org's folder for all of them — in production it is pinned to
  // `/workspace/metacto-revenue` for every request. Offering these tools there
  // handed any bearer token the revenue workspace's agent prompts, skills and
  // its org id. They are therefore absent unless the transport says its
  // contextPath belongs to the caller, which only stdio/CI can say.
  //
  // `versionHistoryTool` and the off switch stay: both are pure database reads
  // scoped by `config.orgId`, which IS the caller's.
  const diskBacked = config.diskWorkspace
    ? [
        listTool(config),
        getTool(config),
        writeSkillTool(config),
        writePlaybookTool(config),
        writeMissionTool(config),
        writeAgentTool(config),
        writeObjectTypeTool(config),
        deleteTool(config),
        applyTool(config),
        diffTool(config),
      ]
    : [];
  return [
    ...diskBacked,
    versionHistoryTool(config),
    ...offSwitchTools(config, identity),
  ];
}

/**
 * The workspace off switch over MCP — one call from wherever the operator is.
 *
 * The same service path as the dashboard's switch and the REST twins
 * (`/api/v1/workspace/pause`), so the hold reads the same whichever door was
 * used: the banner on every page names the MCP identity as the person who
 * pulled it.
 * @param config - The tenant.
 * @param identity - Who the tools act as, for the record.
 * @param identity.userId
 */
function offSwitchTools(config: McpConfig, identity?: { userId: string }): ToolModule[] {
  const by = { id: identity?.userId ?? 'mcp', name: identity?.userId ? null : 'MCP' };
  return [
    {
      name: 'workspace_pause',
      title: 'Pause the whole workspace',
      description: 'Stop everything this workspace does by itself, in one call: every automation fire (scheduled and event), every mission run, every worker run queued or claimed, and every gated action that is not a hand-off a person performs. Chat with an agent stays available — but a turn that tries to start a mission, queue a worker run or execute a gated action is refused with this note. A worker already mid-run is not killed: it finishes and reports. Per-automation pauses are NOT touched, so resuming restores exactly what was there before. The note is required — it is what everyone sees on every page until the switch is lifted. Lift it with workspace_resume.',
      inputSchema: { note: z.string().trim().min(1).max(500) },
      handler: async (input) => {
        const { note } = input as { note: string };
        const pause = await pauseWorkspace(config.orgId, { by, note });
        return { paused: { by: pause.by, at: pause.at.toISOString(), note: pause.note }, refuses: Object.values(PAUSED_CAPABILITIES) };
      },
    },
    {
      name: 'workspace_resume',
      title: 'Resume the whole workspace',
      description: 'Lift a workspace pause placed with workspace_pause (or from the dashboard, or the API). Schedules fire on their next tick and everything else may start again. Automations a person paused individually stay paused — the workspace pause never touched them. Answers whose hold it lifted and what their note said.',
      inputSchema: {},
      handler: async () => {
        const { lifted } = await resumeWorkspace(config.orgId, { by });
        return { paused: null, lifted: { by: lifted.by, at: lifted.at.toISOString(), note: lifted.note } };
      },
    },
  ];
}

function listTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_list',
    title: 'List all context resources',
    description: 'List every agent, skill, playbook, mission, and object type defined in the active workspace directory. Returns slugs, names, and descriptions — not full prompts.',
    inputSchema: {},
    handler: async () => {
      const loaded = loadWorkspace(config.contextPath);
      return {
        sha: loaded.sha,
        orgId: loaded.manifest.orgId,
        agents: loaded.agents.map(a => ({ slug: a.slug, name: a.name, description: a.description, skills: a.skills, objectTypes: a.objectTypes })),
        skills: loaded.skills.map(s => ({ slug: s.slug, name: s.name, description: s.description, origin: s.origin, playbooks: s.playbooks, version: s.version })),
        playbooks: loaded.playbooks.map(p => ({ slug: p.slug, name: p.name, description: p.description, origin: p.origin, version: p.version })),
        missions: loaded.missions.map(m => ({ slug: m.slug, name: m.name, description: m.description, goal: m.goal, agent: m.agent, status: m.status, origin: m.origin })),
        objectTypes: loaded.objectTypes.map(o => ({ slug: o.slug, label: o.label, description: o.description })),
      };
    },
  };
}

function getTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_get',
    title: 'Get full detail of one context resource',
    description: 'Return the full manifest (including prompt text) for one agent, skill, playbook, mission, or object type. Use after workspace_list to pick the slug.',
    inputSchema: {
      kind: z.enum(['agent', 'skill', 'playbook', 'mission', 'object_type']).describe('which resource family'),
      slug: z.string().describe('the slug of the resource'),
    },
    handler: async (input) => {
      const { kind, slug } = input as { kind: 'agent' | 'skill' | 'playbook' | 'mission' | 'object_type'; slug: string };
      const loaded = loadWorkspace(config.contextPath);
      if (kind === 'agent') {
        const a = loaded.agents.find(x => x.slug === slug);
        if (!a) {
          return { error: `agent "${slug}" not found` };
        }
        return { ...a };
      }
      if (kind === 'skill' || kind === 'playbook') {
        const s = (kind === 'skill' ? loaded.skills : loaded.playbooks).find(x => x.slug === slug);
        if (!s) {
          return { error: `${kind} "${slug}" not found` };
        }
        return { ...s };
      }
      if (kind === 'mission') {
        const m = loaded.missions.find(x => x.slug === slug);
        if (!m) {
          return { error: `mission "${slug}" not found` };
        }
        return { ...m };
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
    name: 'workspace_write_skill',
    title: 'Create or update a skill',
    description: 'Write a skill SKILL.md (frontmatter + body) to workspace/<org>/skills/. Writes to disk + auto-applies to DB. Git is external — pass autoCommit=true to opt in. Returns files written, new context SHA, and the apply diff.',
    inputSchema: {
      manifest: toolShape(PlaybookManifestSchema, []),
      prompt_md: z.string().describe('the SKILL.md markdown body (procedure, examples, output contract)'),
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

function writePlaybookTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_write_playbook',
    title: 'Create or update a playbook',
    description: 'Write a playbook SKILL.md (frontmatter + body) to workspace/<org>/playbooks/<slug>/. A playbook is context that travels with a skill or an agent by name. Writes to disk + auto-applies to DB, which also records the new version on the playbook\'s artifact in the app. Git is external — pass autoCommit=true to opt in. Returns files written, new context SHA, and the apply diff.',
    inputSchema: {
      manifest: toolShape(PlaybookManifestSchema, []),
      prompt_md: z.string().describe('the SKILL.md markdown body (the context, rules, examples)'),
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
        kind: 'playbook',
      });
      return runApplyAndCommit(config, written, `update playbook ${written.slug}`, parsed);
    },
  };
}

function writeMissionTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_write_mission',
    title: 'Create or update a mission',
    description: 'Write a mission manifest to workspace/<org>/missions/<slug>.yaml — slug, name, goal, agent (the owner), autonomyPolicy, successCriteria, desiredArtifacts. A mission is a standing responsibility; its cadence lives on an automation, not here. Validates through the mission schema, writes to disk + auto-applies to DB, which also records the new version on the mission\'s artifact in the app. Git is external — pass autoCommit=true to opt in.',
    inputSchema: {
      manifest: toolShape(MissionManifestSchema, []),
      autoApply: z.boolean().default(true).describe('apply to DB after writing (default true)'),
      autoCommit: z.boolean().default(false).describe('git commit after writing (default false; git is external responsibility)'),
      commitMessage: z.string().optional().describe('override default commit message'),
    },
    handler: async (input) => {
      const parsed = parseWriteInput(input, 'prompt_md', true);
      const written = writeMission({
        contextPath: config.contextPath,
        manifest: parsed.manifest as never,
      });
      return runApplyAndCommit(config, written, `update mission ${written.slug}`, parsed);
    },
  };
}

function writeAgentTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_write_agent',
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
    name: 'workspace_write_object_type',
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
    name: 'workspace_delete',
    title: 'Delete a context resource',
    description: 'Remove the files for an agent, skill, playbook, mission, or object type from workspace/<org>/. Auto-commits + auto-applies (which will remove the row from the DB on the next apply).',
    inputSchema: {
      kind: z.enum(['agent', 'skill', 'playbook', 'mission', 'objectType']),
      slug: z.string(),
      autoApply: z.boolean().default(true),
      autoCommit: z.boolean().default(false),
      commitMessage: z.string().optional(),
    },
    handler: async (input) => {
      const { kind, slug, autoApply, autoCommit: doCommit, commitMessage } = input as {
        kind: 'agent' | 'skill' | 'playbook' | 'mission' | 'objectType';
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

async function deleteFromDb(orgId: string, kind: 'agent' | 'skill' | 'playbook' | 'mission' | 'objectType', slug: string): Promise<number> {
  if (kind === 'agent') {
    const rows = await db.delete(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))).returning();
    return rows.length;
  }
  // The file's artifact mirror goes with the row (`libs/workspace/source.ts`)
  // — an orphan mirror is an editable copy of a deleted file.
  const { deleteSourceMirror } = await import('@/services/workspace/WorkspaceSourceService');
  if (kind === 'skill' || kind === 'playbook') {
    const rows = await db.delete(playbookSchema).where(and(eq(playbookSchema.orgId, orgId), eq(playbookSchema.slug, slug), eq(playbookSchema.kind, kind))).returning();
    await deleteSourceMirror(orgId, kind, slug);
    return rows.length;
  }
  if (kind === 'mission') {
    const rows = await db.delete(missionSchema).where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug))).returning();
    await deleteSourceMirror(orgId, 'mission', slug);
    return rows.length;
  }
  const rows = await db.delete(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, slug))).returning();
  return rows.length;
}

function applyTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_apply',
    title: 'Apply pending context to the DB',
    description: 'Reconcile workspace/<org>/ to the database and record a workspace_version audit row. Use after editing files directly (outside MCP) or when auto-apply was disabled.',
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
    name: 'workspace_diff',
    title: 'Show pending context changes',
    description: 'Dry-run apply — shows created/updated/unchanged counts without writing. Equivalent to `workspace_apply dryRun=true`.',
    inputSchema: {},
    handler: async () => applyNow(config, true),
  };
}

function versionHistoryTool(config: McpConfig): ToolModule {
  return {
    name: 'workspace_version_history',
    title: 'List recent context applies',
    description: 'Show the last N workspace_version rows: sha, summary, applied_by, applied_at. Useful for answering "when did this prompt last change?"',
    inputSchema: {
      limit: z.number().int().positive().max(100).default(20),
    },
    handler: async (input) => {
      const { limit } = input as { limit: number };
      const rows = await db
        .select()
        .from(workspaceVersionSchema)
        .where(eq(workspaceVersionSchema.orgId, config.orgId))
        .orderBy(desc(workspaceVersionSchema.appliedAt))
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
    const loaded = loadWorkspace(config.contextPath);
    const result = await applyWorkspace(loaded, { orgId: config.orgId, dryRun, appliedBy: 'mcp' });
    return result;
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
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
    `manifest object — omit ${stripFields.join(', ')} (writer sets them from disk layout). Full schema in src/libs/workspace/schemas.ts.`,
  );
}
