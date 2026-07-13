/**
 * @deprecated v0.2 — prefer `OperationService` (same shape, canonical
 * name). The implementation lives here for the v0.1 → v0.2 transition
 * so the ~12 existing consumers don't have to move in one commit.
 * SkillService keeps working; new code should import from
 * `OperationService` instead.
 */
import type { AnySkill, PluginContext } from '@/libs/plugins';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import process from 'node:process';
import { and, desc, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { db } from '@/libs/DB';
import { cleanUsageDetails, langfuse, pushScore, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { getLLMClient } from '@/libs/llm';
import { pluginRegistry } from '@/libs/plugins';
import { fromRepoRoot } from '@/libs/repo-root';
import { searchLegacyShape } from '@/libs/retrieval/legacyDocument';
import { getCurrentWorkspaceSha, getWorkspacePath } from '@/libs/workspace';
import { skillRunSchema, skillSchema } from '@/models/Schema';

/**
 * Lazy-init OpenAI client. Constructed on first call rather than at module
 * load so importing this file doesn't blow up when `OPENAI_API_KEY` is
 * unset — pages that don't actually invoke a prompt skill (workflow list,
 * dashboard nav, etc.) should not 500 just because they pull a function
 * from this module's transitive graph.
 */
let _openai: OpenAI | undefined;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
  }
  return _openai;
}

export const getSkill = (orgId: string, slug: string) => {
  return db.query.skillSchema.findFirst({
    where: and(eq(skillSchema.orgId, orgId), eq(skillSchema.slug, slug)),
  });
};

export const listSkills = (orgId: string) => {
  return db.query.skillSchema.findMany({
    where: eq(skillSchema.orgId, orgId),
  });
};

/**
 * Dynamic-import + execute a postprocess script for a prompt skill.
 *
 * Scripts live alongside the skill's prompt.md in
 * `workspace/<org>/skills/<slug>/<scriptFile>`. They export a default
 * function `(output, input, ctx) => output`. Script cache is per-process;
 * dev reload via plugins_reload-style mechanism lands in a follow-up.
 *
 * scriptFile may be just a filename (resolved under the skill dir) or
 * a path including the skill-dir prefix. Only .js and .mjs are supported
 * today; .ts requires a compile step we haven't wired yet.
 * @param scriptFile
 * @param rawOutput
 * @param opts
 * @param opts.orgId
 * @param opts.skillSlug
 * @param opts.input
 * @param opts.userId
 */
async function runPostprocessScript(
  scriptFile: string,
  rawOutput: string,
  opts: { orgId: string; skillSlug: string; input: Record<string, unknown>; userId?: string },
): Promise<string> {
  const ext = extname(scriptFile).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs') {
    throw new Error(`scriptFile must be .js or .mjs (got ${ext || 'none'})`);
  }

  const contextPath = getWorkspacePath();
  if (!contextPath) {
    throw new Error(`skill ${opts.skillSlug}: scriptFile requires WORKSPACE_PATH to be set`);
  }
  const slugDir = opts.skillSlug.replace(/_/g, '-');
  // Accept either a bare filename ("postprocess.js") or a full path.
  const relPath = scriptFile.includes('/')
    ? scriptFile
    : join(contextPath, 'skills', slugDir, scriptFile);
  const absPath = fromRepoRoot(relPath);

  if (!existsSync(absPath)) {
    throw new Error(`scriptFile not found: ${relPath}`);
  }

  // Opt out of bundler static analysis — this is a runtime file:// import
  // of an untracked user script, not a dependency. Turbopack honors
  // `turbopackIgnore`; webpack honors `webpackIgnore`. Both need to be
  // present or a Next build blows up with "can't resolve <dynamic>".
  const url = `file://${absPath}?t=${Date.now()}`;
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as { default?: (output: unknown, input: Record<string, unknown>, ctx: { orgId: string; skillSlug: string; userId?: string }) => unknown };
  const fn = mod.default;
  if (typeof fn !== 'function') {
    throw new TypeError(`scriptFile ${relPath} must have a default export function`);
  }

  const result = await fn(rawOutput, opts.input, {
    orgId: opts.orgId,
    skillSlug: opts.skillSlug,
    userId: opts.userId,
  });

  if (typeof result !== 'string') {
    throw new TypeError(`postprocess return must be a string (got ${typeof result})`);
  }
  return result;
}

/**
 * Interpolate {{variables}} in a prompt template.
 * @param template
 * @param vars
 */
function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });
}

/**
 * Execute a skill: interpolate prompt, call LLM, trace in Langfuse, store run.
 * @param opts
 * @param opts.orgId
 * @param opts.skillSlug
 * @param opts.input
 * @param opts.userId
 */
export async function executeSkill(opts: {
  orgId: string;
  skillSlug: string;
  input: Record<string, unknown>;
  userId?: string;
}): Promise<{
  runId: number;
  output: string;
  traceId: string;
  skill: { name: string; slug: string; requiresApproval: string | null };
}> {
  // Plugins take precedence — a registered plugin slug overrides the DB prompt row.
  // Falls back to prompt-only execution when no plugin is registered.
  const plugin = pluginRegistry.getSkill(opts.skillSlug);
  if (plugin) {
    return executePluginSkill(opts, plugin);
  }

  const skill = await getSkill(opts.orgId, opts.skillSlug);
  if (!skill) {
    throw new Error(`Skill "${opts.skillSlug}" not found`);
  }

  const prompt = interpolate(skill.promptTemplate, opts.input);

  // Langfuse trace
  const trace = traceFor({
    feature: FEATURES.OPERATION_RUN,
    slug: skill.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: opts.input,
    metadata: { skillVersion: skill.version, model: skill.model },
  });

  const generation = trace.generation({
    name: 'llm-call',
    model: skill.model ?? 'gpt-4o',
    input: [{ role: 'user', content: prompt }],
    modelParameters: { temperature: Number(skill.temperature ?? 0.3) },
  });

  const startTime = Date.now();

  const completion = await getOpenAI().chat.completions.create({
    model: skill.model ?? 'gpt-4o',
    temperature: Number(skill.temperature ?? 0.3),
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: skill.slug === 'draft_mvp_proposal' ? 8000 : 2000,
  });

  const rawOutput = completion.choices[0]?.message?.content ?? '';
  const elapsed = Date.now() - startTime;

  generation.end({
    output: rawOutput,
    usageDetails: cleanUsageDetails({
      input: completion.usage?.prompt_tokens,
      output: completion.usage?.completion_tokens,
      // OpenAI surfaces cached input tokens under
      // `prompt_tokens_details.cached_tokens` for prompt caching.
      cache_read_input_tokens: completion.usage?.prompt_tokens_details?.cached_tokens,
    }),
  });

  // Optional postprocess script — lives in the skill's context folder as
  // e.g. `postprocess.js`. Default export is called `(output, input, ctx)`
  // and returns the transformed output. Used for cheap deterministic
  // cleanup (strip LLM preambles, normalize whitespace, redact PII).
  let output = rawOutput;
  if (skill.scriptFile) {
    try {
      output = await runPostprocessScript(skill.scriptFile, rawOutput, opts);
    } catch (err) {
      trace.event({ name: 'postprocess_error', metadata: { error: err instanceof Error ? err.message : String(err), scriptFile: skill.scriptFile } });
      // Fail soft — postprocess errors shouldn't drop the run; log and ship raw.
    }
  }

  trace.update({
    output: { result: output.slice(0, 500), elapsed_ms: elapsed },
  });

  // Store run — stamp with the active context SHA so we can answer
  // "which prompt version produced this output" after context edits.
  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId);

  const [run] = await db.insert(skillRunSchema).values({
    orgId: opts.orgId,
    skillId: skill.id,
    input: opts.input,
    output,
    status: skill.requiresApproval === 'true' ? 'pending' : 'auto',
    langfuseTraceId: trace.id,
    workspaceSha,
    createdBy: opts.userId,
  }).returning();

  await langfuse.flushAsync();

  return {
    runId: run!.id,
    output,
    traceId: trace.id,
    skill: { name: skill.name, slug: skill.slug, requiresApproval: skill.requiresApproval },
  };
}

/**
 * Execute a plugin-registered skill. Validates input + output via the plugin's
 * Zod schemas, builds a scoped PluginContext, runs the handler, persists the
 * result in skill_run (lazy-upserting a skill row so downstream queries that
 * join skill_run → skill keep working).
 * @param opts
 * @param opts.orgId
 * @param opts.skillSlug
 * @param opts.input
 * @param opts.userId
 * @param plugin
 */
async function executePluginSkill(
  opts: { orgId: string; skillSlug: string; input: Record<string, unknown>; userId?: string },
  plugin: AnySkill,
): Promise<{ runId: number; output: string; traceId: string; skill: { name: string; slug: string; requiresApproval: string | null } }> {
  const inputParsed = plugin.inputSchema.safeParse(opts.input);
  if (!inputParsed.success) {
    throw new Error(`invalid input for plugin skill "${plugin.slug}": ${inputParsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }

  const trace = traceFor({
    feature: FEATURES.OPERATION_RUN,
    slug: plugin.slug,
    orgId: opts.orgId,
    userId: opts.userId ?? 'system',
    input: opts.input,
    metadata: { pluginVersion: plugin.version, kind: 'plugin' },
  });

  const workspaceSha = await getCurrentWorkspaceSha(opts.orgId);

  // Resolve the LLM client for the skill's declared provider. Lazy-initialised
  // per process + provider; throws with a clear message if the chosen provider
  // is missing its API key.
  const llm = getLLMClient(plugin.provider ?? 'openai');

  const ctx: PluginContext = {
    orgId: opts.orgId,
    openai: getOpenAI(),
    llm,
    workspaceSha,
    invokedBy: opts.userId ?? 'mcp',
    log: (level, message, fields) => {
      trace.event({ name: `${level}:${message}`, metadata: fields });
    },
    retrieve: async (query, options) => {
      const result = await searchLegacyShape({
        query,
        search_filters: options?.sources ? { source_type: options.sources } : undefined,
      });
      const k = options?.k ?? 8;
      const top = ((result?.top_documents ?? []) as Array<Record<string, unknown>>).slice(0, k);
      return top.map(d => ({
        documentId: String(d.document_id ?? ''),
        identifier: String(d.semantic_identifier ?? ''),
        source: String(d.source_type ?? ''),
        blurb: String(d.blurb ?? ''),
        link: (d.link as string | null | undefined) ?? null,
        score: Number(d.score ?? 0),
        updatedAt: (d.updated_at as string | null | undefined) ?? null,
      }));
    },
  };

  const startTime = Date.now();
  let output: unknown;
  try {
    output = await plugin.run(ctx, inputParsed.data);
  } catch (err) {
    trace.update({ output: { error: err instanceof Error ? err.message : String(err) } });
    await langfuse.flushAsync();
    throw err;
  }
  const elapsed = Date.now() - startTime;

  const outputParsed = plugin.outputSchema.safeParse(output);
  if (!outputParsed.success) {
    throw new Error(`plugin "${plugin.slug}" returned invalid output: ${outputParsed.error.issues.map(i => i.message).join('; ')}`);
  }

  trace.update({ output: { elapsed_ms: elapsed, preview: JSON.stringify(output).slice(0, 500) } });

  // Ensure a skill row exists so skill_run.skill_id FK is satisfied.
  const skillRow = await upsertPluginSkillRow(opts.orgId, plugin);

  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
  const [run] = await db.insert(skillRunSchema).values({
    orgId: opts.orgId,
    skillId: skillRow.id,
    input: opts.input,
    output: outputStr,
    status: plugin.requiresApproval ? 'pending' : 'auto',
    langfuseTraceId: trace.id,
    workspaceSha,
    createdBy: opts.userId,
  }).returning();

  await langfuse.flushAsync();

  return {
    runId: run!.id,
    output: outputStr,
    traceId: trace.id,
    skill: { name: plugin.name, slug: plugin.slug, requiresApproval: plugin.requiresApproval ? 'true' : 'false' },
  };
}

/**
 * Lazily create or update the skill DB row for a plugin. Keeps plugin-driven
 * skills visible in the same catalog as context-authored ones without
 * requiring a manual workspace:apply.
 * @param orgId
 * @param plugin
 */
async function upsertPluginSkillRow(orgId: string, plugin: AnySkill) {
  const existing = await getSkill(orgId, plugin.slug);
  if (existing) {
    return existing;
  }
  const [row] = await db.insert(skillSchema).values({
    orgId,
    slug: plugin.slug,
    name: plugin.name,
    description: plugin.description ?? null,
    promptTemplate: `[plugin: ${plugin.slug}@${plugin.version}]`,
    category: plugin.category ?? 'query',
    status: 'active',
    requiresApproval: plugin.requiresApproval ? 'true' : 'false',
    model: 'plugin',
    version: 1,
  }).returning();
  return row!;
}

/**
 * List skill_run rows for an org, newest first. Primarily for MCP
 * runtime.list_runs and the upcoming review queue.
 * @param opts
 * @param opts.orgId
 * @param opts.status
 * @param opts.skillSlug
 * @param opts.rating
 * @param opts.limit
 */
export async function listSkillRuns(opts: {
  orgId: string;
  status?: 'pending' | 'approved' | 'rejected' | 'auto';
  skillSlug?: string;
  rating?: 'up' | 'down';
  limit?: number;
}): Promise<Array<typeof skillRunSchema.$inferSelect>> {
  const filters = [eq(skillRunSchema.orgId, opts.orgId)];
  if (opts.status) {
    filters.push(eq(skillRunSchema.status, opts.status));
  }
  if (opts.rating) {
    filters.push(eq(skillRunSchema.rating, opts.rating));
  }
  if (opts.skillSlug) {
    const skill = await getSkill(opts.orgId, opts.skillSlug);
    if (!skill) {
      return [];
    }
    filters.push(eq(skillRunSchema.skillId, skill.id));
  }
  return db
    .select()
    .from(skillRunSchema)
    .where(and(...filters))
    .orderBy(desc(skillRunSchema.createdAt))
    .limit(opts.limit ?? 50);
}

/**
 * Get a single skill run, scoped to an org. Returns null if not found or cross-tenant.
 * @param orgId
 * @param runId
 */
export async function getSkillRun(orgId: string, runId: number): Promise<typeof skillRunSchema.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(skillRunSchema)
    .where(and(eq(skillRunSchema.id, runId), eq(skillRunSchema.orgId, orgId)));
  return row ?? null;
}

/**
 * Mark a skill run as approved. Only valid transition from `pending`.
 * Auto-status runs can't be approved (they weren't gated).
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.reviewedBy
 */
export type FeedbackInput = {
  rating?: 'up' | 'down' | null;
  note?: string | null;
};

export async function approveSkillRun(opts: { orgId: string; runId: number; reviewedBy: string; feedback?: FeedbackInput }): Promise<typeof skillRunSchema.$inferSelect | null> {
  return transitionStatus(opts.orgId, opts.runId, 'approved', opts.reviewedBy, opts.feedback);
}

export async function rejectSkillRun(opts: { orgId: string; runId: number; reviewedBy: string; feedback?: FeedbackInput }): Promise<typeof skillRunSchema.$inferSelect | null> {
  return transitionStatus(opts.orgId, opts.runId, 'rejected', opts.reviewedBy, opts.feedback);
}

/**
 * Submit (or update) post-hoc feedback on any skill run — works after
 * approve/reject, doesn't change status. Useful for "was this useful?"
 * surveys or rating auto-run skills that never hit the review queue.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.submittedBy
 * @param opts.rating
 * @param opts.note
 */
export async function submitSkillRunFeedback(opts: { orgId: string; runId: number; submittedBy: string; rating?: 'up' | 'down' | null; note?: string | null }): Promise<typeof skillRunSchema.$inferSelect | null> {
  const [updated] = await db
    .update(skillRunSchema)
    .set({
      rating: opts.rating ?? null,
      feedbackNote: opts.note ?? null,
      feedbackBy: opts.submittedBy,
      feedbackAt: new Date(),
    })
    .where(and(eq(skillRunSchema.id, opts.runId), eq(skillRunSchema.orgId, opts.orgId)))
    .returning();
  // Mirror the rating into Langfuse as a `user-thumbs` score on the
  // associated trace. Per the Langfuse user-feedback skill: keep the
  // name signal-source-shaped (not "quality"), BOOLEAN dataType, 1/0.
  // Skipping when rating is cleared (null) — Langfuse scores append-only.
  if (updated?.rating === 'up' || updated?.rating === 'down') {
    pushScore({
      traceId: updated.langfuseTraceId,
      name: 'user-thumbs',
      value: updated.rating === 'up' ? 1 : 0,
      comment: updated.feedbackNote,
    });
  }
  return updated ?? null;
}

async function transitionStatus(orgId: string, runId: number, to: 'approved' | 'rejected', reviewedBy: string, feedback?: FeedbackInput) {
  const current = await getSkillRun(orgId, runId);
  if (!current) {
    return null;
  }
  if (current.status !== 'pending') {
    throw new Error(`run ${runId} is ${current.status}, only pending runs can be ${to}`);
  }
  const now = new Date();
  const [updated] = await db
    .update(skillRunSchema)
    .set({
      status: to,
      reviewedBy,
      reviewedAt: now,
      ...(feedback?.rating !== undefined || feedback?.note !== undefined
        ? {
            rating: feedback.rating ?? null,
            feedbackNote: feedback.note ?? null,
            feedbackBy: reviewedBy,
            feedbackAt: now,
          }
        : {}),
    })
    .where(and(eq(skillRunSchema.id, runId), eq(skillRunSchema.orgId, orgId)))
    .returning();

  // Forward the review signal to Langfuse as two distinct scores —
  // `review-decision` captures the approve/reject signal; `user-thumbs`
  // captures the optional rating. Keeping them separate lets dashboards
  // tell "approved despite a thumbs-down" from "approved with applause".
  if (updated?.langfuseTraceId) {
    pushScore({
      traceId: updated.langfuseTraceId,
      name: 'review-decision',
      value: to === 'approved' ? 1 : 0,
      comment: feedback?.note,
    });
    if (feedback?.rating === 'up' || feedback?.rating === 'down') {
      pushScore({
        traceId: updated.langfuseTraceId,
        name: 'user-thumbs',
        value: feedback.rating === 'up' ? 1 : 0,
        comment: feedback.note,
      });
    }
  }
  return updated ?? null;
}
