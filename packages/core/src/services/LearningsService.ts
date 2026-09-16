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

import { and, eq, sql } from 'drizzle-orm';
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
      // How many people asked for this rule before it was adopted — carried
      // over from the candidate it came from, and the reason the column exists.
      occurrenceCount: r.occurrenceCount,
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
  /**
   * The agent this rule is about. A rule adopted from a candidate carries a
   * `feedback:<id>` source rather than an `agent:<slug>` one, so the slug
   * cannot be parsed back out of `source` — without this the adoption stream
   * records the rule with no agent and the per-agent view never sees it.
   */
  agentSlug?: string | null;
  /** How many separate pieces of feedback asked for this rule. */
  occurrenceCount?: number;
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
      occurrenceCount: opts.occurrenceCount ?? 1,
    })
    .returning();
  if (opts.createdBy && row) {
    // Deliberately not awaited — adoption tracking must never slow down or fail
    // the write. It does need its own catch: an unhandled rejection out here
    // has no caller left to surface it.
    void (async () => {
      try {
        const [{ track }, { agentSlugFromPrincipal }] = await Promise.all([
          import('@/services/adoption/track'),
          import('@/services/adoption/attribution'),
        ]);
        await track({ orgId: opts.orgId, userId: opts.createdBy! }, 'learning.added', {
          // Rules written straight at an agent carry an 'agent:<slug>' source.
          // Rules adopted from feedback carry 'feedback:<id>' instead, so the
          // caller passes the slug it already resolved.
          agentSlug: opts.agentSlug ?? agentSlugFromPrincipal(opts.source),
          resource: ['learning', row.id],
        });
      } catch (error) {
        console.error(`[LearningsService] could not track learning.added for rule ${row.id}`, error);
      }
    })();
  }
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
 * Render cache: rendering is cheap but pure waste to repeat every turn, and
 * it grows with the rule count. The fingerprint is one indexed aggregate per
 * step per turn; only a changed step re-renders. In-process (per instance),
 * which is always correct — a stale entry can't survive its fingerprint.
 *
 * `last_used_at` stamping deliberately uses raw SQL: Drizzle's `$onUpdate`
 * would bump `updated_at` on every stamp, which would both churn this cache's
 * fingerprint every turn and make "rule changed" indistinguishable from
 * "rule was read".
 */
const renderCache = new Map<string, { fingerprint: string; content: string }>();
const RENDER_CACHE_LIMIT = 256;

/** Test hook. */
export function resetLearningsRenderCache(): void {
  renderCache.clear();
}

async function stepFingerprint(orgId: string, stepName: string): Promise<string | null> {
  const [row] = await db
    .select({
      stepUpdatedAt: learningStepSchema.updatedAt,
      ruleCount: sql<number>`count(${learningSchema.id})::int`,
      maxRuleUpdatedAt: sql<string | null>`max(${learningSchema.updatedAt})::text`,
    })
    .from(learningStepSchema)
    .leftJoin(learningSchema, and(
      eq(learningSchema.stepId, learningStepSchema.id),
      eq(learningSchema.orgId, orgId),
    ))
    .where(and(eq(learningStepSchema.orgId, orgId), eq(learningStepSchema.name, stepName)))
    .groupBy(learningStepSchema.id);
  if (!row) {
    return null;
  }
  return `${row.stepUpdatedAt.toISOString()}|${row.ruleCount}|${row.maxRuleUpdatedAt ?? ''}`;
}

/**
 * Stamp every rule in the step as read now — the staleness signal the
 * dashboard's "last used" column reads. Fire-and-forget from the bundle path:
 * a failed stamp must never fail a turn.
 * @param orgId
 * @param stepName
 */
async function stampStepUsed(orgId: string, stepName: string): Promise<void> {
  await db.execute(sql`
    UPDATE learning SET last_used_at = now()
    WHERE org_id = ${orgId}
      AND step_id = (SELECT id FROM learning_step WHERE org_id = ${orgId} AND name = ${stepName})
  `);
}

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
      const fingerprint = await stepFingerprint(orgId, name);
      if (fingerprint === null) {
        // Unknown step — skip silently. The agent's learningSteps list
        // is the authoring contract; missing steps mean workspace:apply
        // hasn't seeded them yet.
        continue;
      }
      const cacheKey = `${orgId}::${name}`;
      const cached = renderCache.get(cacheKey);
      let content: string;
      if (cached && cached.fingerprint === fingerprint) {
        content = cached.content;
      } else {
        content = await renderStepMarkdown(orgId, name);
        if (renderCache.size >= RENDER_CACHE_LIMIT && !renderCache.has(cacheKey)) {
          const first = renderCache.keys().next().value;
          if (first !== undefined) {
            renderCache.delete(first);
          }
        }
        renderCache.set(cacheKey, { fingerprint, content });
      }
      out[`/learnings/${name}.md`] = content;
      void stampStepUsed(orgId, name).catch((error) => {
        console.error(`[LearningsService] could not stamp last_used_at for step ${name}`, error);
      });
    } catch {
      // Same contract as before the cache: a step that cannot render is
      // skipped, never a failed turn.
    }
  }
  return out;
}
