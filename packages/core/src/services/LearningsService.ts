/**
 * LearningsService — per-step rule store with fuzzy dedup.
 *
 * Mirrors rev-ai's server/learnings.py (the canonical pattern). Steps
 * are whitelisted via the `learning_step` table — they're seeded by
 * `workspace:apply` from `workspace/<org>/learnings/<step>.yaml` so the
 * set doesn't drift into a junk drawer of near-duplicates.
 *
 * Dedup: rev-ai uses Python's `difflib.SequenceMatcher` ratio at 0.72.
 * In TS we use a trigram Jaccard index — different algorithm, similar
 * threshold (0.72 is high enough to catch obvious rephrases and low
 * enough to leave room for adjacent-but-distinct rules). The exact
 * number is tunable per-org in a later phase.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { learningSchema, learningStepSchema } from '@/models/Schema';

const DEDUP_THRESHOLD = 0.72;

/* ------------------------------------------------------------------ */
/* Step catalog                                                        */
/* ------------------------------------------------------------------ */

export async function listSteps(orgId: string) {
  const steps = await db
    .select()
    .from(learningStepSchema)
    .where(eq(learningStepSchema.orgId, orgId));

  // Count rules per step in a follow-up pass to avoid a join.
  const out: Array<{
    name: string;
    title: string;
    description: string;
    preamble: string | null;
    agentSlugs: string[];
    ruleCount: number;
  }> = [];
  for (const s of steps) {
    const rules = await db
      .select({ id: learningSchema.id })
      .from(learningSchema)
      .where(and(eq(learningSchema.orgId, orgId), eq(learningSchema.stepId, s.id)));
    out.push({
      name: s.name,
      title: s.title,
      description: s.description,
      preamble: s.preamble,
      agentSlugs: s.agentSlugs,
      ruleCount: rules.length,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Get rules for one step                                              */
/* ------------------------------------------------------------------ */

export async function getLearnings(orgId: string, stepName: string) {
  const [step] = await db
    .select()
    .from(learningStepSchema)
    .where(and(eq(learningStepSchema.orgId, orgId), eq(learningStepSchema.name, stepName)));
  if (!step) {
    throw new Error(`unknown learning step ${JSON.stringify(stepName)}`);
  }
  const rules = await db
    .select()
    .from(learningSchema)
    .where(and(eq(learningSchema.orgId, orgId), eq(learningSchema.stepId, step.id)));
  return {
    step: step.name,
    title: step.title,
    preamble: step.preamble,
    rules: rules.map(r => ({
      id: r.id,
      ruleText: r.ruleText,
      source: r.source,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Render one step's markdown view — what the agent reads at runtime  */
/* ------------------------------------------------------------------ */

export async function renderStepMarkdown(orgId: string, stepName: string): Promise<string> {
  const data = await getLearnings(orgId, stepName);
  const lines = [`# ${data.title} learnings`, ''];
  if (data.preamble) {
    lines.push(data.preamble, '', '---', '', '## Captured patterns', '');
  }
  if (data.rules.length === 0) {
    lines.push('_No rules yet._', '');
  } else {
    lines.push(`_${data.rules.length} active rule(s). Apply them on every relevant action._`, '');
    for (const r of data.rules) {
      const ts = r.createdAt.toISOString().slice(0, 10);
      const src = r.source ?? 'manual';
      lines.push(`<!-- id: ${r.id} · ${ts} · source: ${src} -->`);
      lines.push(r.ruleText.trim(), '', '---', '');
    }
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Dedup — trigram Jaccard                                             */
/* ------------------------------------------------------------------ */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`#>]+/g, ' ') // strip markdown punct
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(s: string): Set<string> {
  const n = normalize(s);
  const padded = `  ${n} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

export function similarity(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 || B.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const t of A) {
    if (B.has(t)) {
      intersection++;
    }
  }
  const union = A.size + B.size - intersection;
  return intersection / union;
}

export async function checkDedup(
  orgId: string,
  stepName: string,
  ruleText: string,
): Promise<{ ok: true } | { ok: false; existingId: number; existingRule: string; similarity: number }> {
  const data = await getLearnings(orgId, stepName);
  let best: { id: number; ruleText: string; score: number } | null = null;
  for (const r of data.rules) {
    const score = similarity(ruleText, r.ruleText);
    if (score >= DEDUP_THRESHOLD && (best === null || score > best.score)) {
      best = { id: r.id, ruleText: r.ruleText, score };
    }
  }
  if (best === null) {
    return { ok: true };
  }
  return {
    ok: false,
    existingId: best.id,
    existingRule: best.ruleText,
    similarity: Math.round(best.score * 1000) / 1000,
  };
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export async function addLearning(opts: {
  orgId: string;
  stepName: string;
  ruleText: string;
  source?: string;
  createdBy?: string;
}) {
  const text = opts.ruleText.trim();
  if (!text) {
    throw new Error('rule text must not be empty');
  }
  const dup = await checkDedup(opts.orgId, opts.stepName, text);
  if (!dup.ok) {
    return {
      ok: false as const,
      error: 'near_duplicate' as const,
      existing: dup,
      detail: `near-duplicate (similarity ${dup.similarity}) of existing rule #${dup.existingId}. Use updateLearning to refine that one, or reword if genuinely different.`,
    };
  }
  const [step] = await db
    .select()
    .from(learningStepSchema)
    .where(and(eq(learningStepSchema.orgId, opts.orgId), eq(learningStepSchema.name, opts.stepName)));
  if (!step) {
    throw new Error(`unknown learning step ${opts.stepName}`);
  }
  const [row] = await db
    .insert(learningSchema)
    .values({
      orgId: opts.orgId,
      stepId: step.id,
      ruleText: text,
      source: opts.source ?? null,
      createdBy: opts.createdBy ?? null,
    })
    .returning();
  return { ok: true as const, rule: row };
}

export async function updateLearning(opts: {
  orgId: string;
  ruleId: number;
  ruleText: string;
}) {
  const text = opts.ruleText.trim();
  if (!text) {
    throw new Error('rule text must not be empty');
  }
  const [row] = await db
    .update(learningSchema)
    .set({ ruleText: text })
    .where(and(eq(learningSchema.orgId, opts.orgId), eq(learningSchema.id, opts.ruleId)))
    .returning();
  if (!row) {
    return { ok: false as const, error: 'not_found' as const };
  }
  return { ok: true as const, rule: row };
}

export async function removeLearning(opts: { orgId: string; ruleId: number }) {
  const [row] = await db
    .delete(learningSchema)
    .where(and(eq(learningSchema.orgId, opts.orgId), eq(learningSchema.id, opts.ruleId)))
    .returning();
  if (!row) {
    return { ok: false as const, error: 'not_found' as const };
  }
  return { ok: true as const, removedId: row.id };
}

/* ------------------------------------------------------------------ */
/* Markdown bundle for the agent's virtual FS                          */
/* ------------------------------------------------------------------ */

/**
 * Returns `{ '/learnings/<step>.md': content }` for the given step
 * names. Used by services/agents/harness.ts:buildInitialFiles to seed
 * the agent's deepagents StateBackend per turn.
 * @param orgId
 * @param stepNames
 */
export async function bundleStepMarkdown(
  orgId: string,
  stepNames: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of stepNames) {
    try {
      out[`/learnings/${name}.md`] = await renderStepMarkdown(orgId, name);
    } catch {
      // Unknown step — skip silently. The agent's learningSteps list
      // is the authoring contract; missing steps mean workspace:apply
      // hasn't seeded them yet.
    }
  }
  return out;
}
