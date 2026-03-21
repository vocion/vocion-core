import { and, eq } from 'drizzle-orm';
import OpenAI from 'openai';
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

  // Store run
  const [run] = await db.insert(skillRunSchema).values({
    orgId: opts.orgId,
    skillId: skill.id,
    input: opts.input,
    output,
    status: skill.requiresApproval === 'true' ? 'pending' : 'auto',
    langfuseTraceId: trace.id,
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
