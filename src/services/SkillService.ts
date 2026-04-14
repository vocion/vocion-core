import { and, desc, eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { getCurrentContextSha } from '@/libs/context';
import { db } from '@/libs/DB';
import { langfuse } from '@/libs/Langfuse';
import { skillRunSchema, skillSchema } from '@/models/Schema';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

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
  const skill = await getSkill(opts.orgId, opts.skillSlug);
  if (!skill) {
    throw new Error(`Skill "${opts.skillSlug}" not found`);
  }

  const prompt = interpolate(skill.promptTemplate, opts.input);

  // Langfuse trace
  const trace = langfuse.trace({
    name: `skill:${skill.slug}`,
    input: opts.input,
    metadata: { orgId: opts.orgId, skillVersion: skill.version, model: skill.model },
  });

  const generation = trace.generation({
    name: 'llm-call',
    model: skill.model ?? 'gpt-4o',
    input: [{ role: 'user', content: prompt }],
    modelParameters: { temperature: Number(skill.temperature ?? 0.3) },
  });

  const startTime = Date.now();

  const completion = await openai.chat.completions.create({
    model: skill.model ?? 'gpt-4o',
    temperature: Number(skill.temperature ?? 0.3),
    messages: [{ role: 'user', content: prompt }],
    max_completion_tokens: skill.slug === 'draft_mvp_proposal' ? 8000 : 2000,
  });

  const output = completion.choices[0]?.message?.content ?? '';
  const elapsed = Date.now() - startTime;

  generation.end({
    output,
    usage: {
      input: completion.usage?.prompt_tokens,
      output: completion.usage?.completion_tokens,
    },
  });

  trace.update({
    output: { result: output.slice(0, 500), elapsed_ms: elapsed },
  });

  // Store run — stamp with the active context SHA so we can answer
  // "which prompt version produced this output" after context edits.
  const contextSha = await getCurrentContextSha(opts.orgId);

  const [run] = await db.insert(skillRunSchema).values({
    orgId: opts.orgId,
    skillId: skill.id,
    input: opts.input,
    output,
    status: skill.requiresApproval === 'true' ? 'pending' : 'auto',
    langfuseTraceId: trace.id,
    contextSha,
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
 * List skill_run rows for an org, newest first. Primarily for MCP
 * runtime.list_runs and the upcoming review queue.
 * @param opts
 * @param opts.orgId
 * @param opts.status
 * @param opts.skillSlug
 * @param opts.limit
 */
export async function listSkillRuns(opts: {
  orgId: string;
  status?: 'pending' | 'approved' | 'rejected' | 'auto';
  skillSlug?: string;
  limit?: number;
}): Promise<Array<typeof skillRunSchema.$inferSelect>> {
  const filters = [eq(skillRunSchema.orgId, opts.orgId)];
  if (opts.status) {
    filters.push(eq(skillRunSchema.status, opts.status));
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
export async function approveSkillRun(opts: { orgId: string; runId: number; reviewedBy: string }): Promise<typeof skillRunSchema.$inferSelect | null> {
  return transitionStatus(opts.orgId, opts.runId, 'approved', opts.reviewedBy);
}

export async function rejectSkillRun(opts: { orgId: string; runId: number; reviewedBy: string; reason?: string }): Promise<typeof skillRunSchema.$inferSelect | null> {
  return transitionStatus(opts.orgId, opts.runId, 'rejected', opts.reviewedBy);
}

async function transitionStatus(orgId: string, runId: number, to: 'approved' | 'rejected', reviewedBy: string) {
  const current = await getSkillRun(orgId, runId);
  if (!current) {
    return null;
  }
  if (current.status !== 'pending') {
    throw new Error(`run ${runId} is ${current.status}, only pending runs can be ${to}`);
  }
  const [updated] = await db
    .update(skillRunSchema)
    .set({ status: to, reviewedBy, reviewedAt: new Date() })
    .where(and(eq(skillRunSchema.id, runId), eq(skillRunSchema.orgId, orgId)))
    .returning();
  return updated ?? null;
}
