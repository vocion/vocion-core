/**
 * ConsolidationService — the compaction half of the memory loop (scoped-memory
 * plan, Phase 4).
 *
 * A scheduled pass per org that:
 *   1. compacts mature namespaces — when a namespace's rule count is over
 *      budget (~30) or it holds near-duplicates, one model call proposes a
 *      smaller, stronger set, each proposal naming the keys it replaces;
 *   2. mines fresh episodes (TTL'd run outcomes) for candidate rules;
 *   3. drafts a procedure amendment when a workflow namespace matures, so
 *      learnings graduate toward skills/playbooks.
 *
 * EVERY write is a gated proposal: the job only ever inserts pending
 * `learning_candidate` rows. A consolidation candidate carries
 * `replaces_keys`, and it is APPROVAL (decideCandidate) that writes the new
 * rule and retires the old ones in one human decision. The job never touches
 * the store itself — that is the whole point after PolinRider.
 *
 * Model calls run on the `classifier` role (Haiku, temperature 0) and fail
 * CLOSED: unparseable output proposes nothing, because a wrong merge that a
 * tired reviewer rubber-stamps is worse than a namespace staying big for
 * another day.
 *
 * Scheduling: the feedback worker's loop ticks this once per
 * `VOCION_CONSOLIDATION_INTERVAL_HOURS` (default 24) per org; the per-org
 * cursor lives in the memory table under `/consolidation/state.json`.
 * `npm run consolidate:run -- --org <id>` runs one org by hand.
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { buildChatModel } from '@/libs/llm';
import { usageMetadataOf } from '@/libs/llm/usage';
import { MEMORY_STORE_NAMESPACE } from '@/libs/memory/store';
import { learningCandidateSchema, memoryNamespaceSchema, memorySchema } from '@/models/Schema';
import { chargeModelCall } from '@/services/budget/chargeModelCall';
import { recordProposedRule } from '@/services/feedback/ruleRecorder';
import { createCandidate } from '@/services/LearningCandidateService';
import { getNamespace, listEpisodes, listNamespaces, similarity } from '@/services/MemoryService';

/** Active rules a namespace may hold before compaction proposes merges. */
export const NAMESPACE_BUDGET = Number(process.env.VOCION_MEMORY_NAMESPACE_BUDGET ?? 30);

/**
 * Adopted-rule pairs at or above this similarity flag a namespace for
 * compaction. Deliberately far below the 0.72 the add-gate refuses at — a
 * true near-duplicate can never be adopted, so what compaction hunts is
 * RELATED rules that drifted in through different wording.
 */
const RELATED_THRESHOLD = 0.35;

/** A workflow namespace with this many rules is mature enough to graduate. */
const MATURITY_THRESHOLD = 5;

/** Episodes are mined in one batch per pass, capped for prompt sanity. */
const EPISODE_BATCH = 40;

/* ------------------------------------------------------------------ */
/* Model prompts                                                       */
/* ------------------------------------------------------------------ */

const COMPACT_SYSTEM = `You compact an AI agent's rulebook. You are given a numbered list of approved rules from ONE bucket. Propose a SMALLER set of stronger rules that preserves every behavior the originals require.

Rules for merging:
  - Merge only rules that are about the same behavior. Never merge rules about different situations.
  - A merged rule must be a standalone instruction that, followed alone, satisfies every rule it replaces. Losing an approved behavior is the one unforgivable failure.
  - Keep a rule as-is (do not list it) when nothing merges with it.
  - Never invent behavior nobody asked for.

Return STRICT JSON:
{"merged": [{"text": "the stronger combined rule", "replaces": [1, 4]}]}

"replaces" holds the NUMBERS of the input rules the new text covers (at least 2). Return {"merged": []} when nothing should merge.`;

const MergedZ = z.object({
  merged: z.array(z.object({
    text: z.string().min(1),
    // min(1) here, min(2) enforced per item in code: one malformed merge must
    // drop THAT merge, not veto the whole payload.
    replaces: z.array(z.number().int().positive()).min(1),
  })),
});

const MINE_SYSTEM = `You mine an AI agent team's run outcomes (episodes) for standing rules worth proposing. You are given recent episodes: review decisions, ratings, eval scores.

Propose a rule ONLY when the episodes show a REPEATED pattern (the same kind of failure or praise, more than once) that a standing instruction would fix or preserve. One-off outcomes are not rules. Write each rule as a standalone instruction. Name the agent the rule is about when the episodes do.

Return STRICT JSON:
{"rules": [{"text": "...", "agent_slug": "..." | null, "polarity": "correct" | "reinforce"}]}

Return {"rules": []} when the episodes show no repeated pattern.`;

const MinedZ = z.object({
  rules: z.array(z.object({
    text: z.string().min(1),
    agent_slug: z.string().nullable().optional(),
    polarity: z.enum(['correct', 'reinforce']).optional(),
  })),
});

const AMEND_SYSTEM = `You draft ONE procedure amendment from an AI agent's accumulated rules. You are given the rules of one mature bucket. Write a single, coherent procedure section (a few sentences) that a human could paste into the team's skill/playbook so these one-line rules graduate into the written procedure.

Return STRICT JSON:
{"amendment": "..."}`;

const AmendZ = z.object({ amendment: z.string().min(1) });

/**
 * One structured classifier call. Fails CLOSED: any model or parse failure
 * returns null and the caller proposes nothing.
 * @param opts
 * @param opts.orgId
 * @param opts.name - Generation name for the trace.
 * @param opts.system
 * @param opts.user
 * @param opts.schema
 */
async function judged<T>(opts: { orgId: string; name: string; system: string; user: string; schema: z.ZodType<T> }): Promise<T | null> {
  const trace = traceFor({
    feature: FEATURES.FEEDBACK_CLASSIFY,
    slug: `consolidation-${opts.name}`,
    orgId: opts.orgId,
    userId: 'consolidation',
    input: { chars: opts.user.length },
  });
  const generation = trace.generation({ name: opts.name, model: 'classifier', input: opts.user });
  try {
    const model = buildChatModel('classifier', { temperature: 0 });
    const res = await model.invoke([new SystemMessage(opts.system), new HumanMessage(opts.user)]);
    const raw = typeof res.content === 'string'
      ? res.content
      : (Array.isArray(res.content) ? res.content.map(part => (part as { text?: string }).text ?? '').join('') : '');
    if (process.env.VOCION_DEBUG_CONSOLIDATION) {
      console.error(`[consolidation:${opts.name}] raw model output:\n${raw}`);
    }
    const usage = usageMetadataOf(res);
    generation.end({
      output: raw,
      usageDetails: usage ? cleanUsageDetails({ input: usage.input_tokens, output: usage.output_tokens }) : undefined,
    });
    // Charged, never refused: consolidation is a background sweep, and a half
    // consolidated set of learnings is worse than a slightly larger bill.
    await chargeModelCall({
      orgId: opts.orgId,
      feature: FEATURES.FEEDBACK_CLASSIFY,
      role: 'classifier',
      response: res,
    });
    const stripped = raw.replace(/^```(?:json)?\s*|\s*```$/gm, '').trim();
    // Haiku sometimes appends prose after the JSON; take the outermost object.
    let json: unknown;
    try {
      json = JSON.parse(stripped);
    } catch {
      const start = stripped.indexOf('{');
      const end = stripped.lastIndexOf('}');
      if (start < 0 || end <= start) {
        throw new Error('no JSON object in model output');
      }
      json = JSON.parse(stripped.slice(start, end + 1));
    }
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) {
      trace.update({ output: { failed: 'schema' } });
      return null;
    }
    trace.update({ output: parsed.data as Record<string, unknown> });
    return parsed.data;
  } catch (error) {
    console.error(`[ConsolidationService] ${opts.name} model call failed; proposing nothing`, error);
    trace.update({ output: { failed: 'model' } });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Passes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Does the namespace need compaction — over budget, or holding near-duplicates?
 * @param rules
 */
function needsCompaction(rules: Array<{ ruleText: string }>): boolean {
  if (rules.length > NAMESPACE_BUDGET) {
    return true;
  }
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (similarity(rules[i]!.ruleText, rules[j]!.ruleText) >= RELATED_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

/**
 * A pending consolidation proposal already exists for this namespace — one at
 * a time, or the queue fills with contradictory merges of the same rules.
 * @param orgId
 * @param stepName
 */
async function hasPendingConsolidation(orgId: string, stepName: string): Promise<boolean> {
  const [row] = await db
    .select({ id: learningCandidateSchema.id })
    .from(learningCandidateSchema)
    .where(and(
      eq(learningCandidateSchema.orgId, orgId),
      eq(learningCandidateSchema.stepName, stepName),
      eq(learningCandidateSchema.status, 'pending'),
      sql`${learningCandidateSchema.replacesKeys} is not null`,
    ))
    .limit(1);
  return Boolean(row);
}

/**
 * Compact one namespace: propose merges as pending candidates carrying
 * `replaces_keys`. Returns how many proposals were queued.
 * @param orgId
 * @param name - Namespace name.
 */
export async function compactNamespace(orgId: string, name: string): Promise<number> {
  const ns = await getNamespace(orgId, name);
  if (ns.rules.length < 2 || !needsCompaction(ns.rules) || await hasPendingConsolidation(orgId, name)) {
    return 0;
  }
  const numbered = ns.rules.map((r, i) => `  ${i + 1}. ${r.ruleText.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
  const result = await judged({
    orgId,
    name: 'compact',
    system: COMPACT_SYSTEM,
    user: `Bucket: ${ns.title}\nRules:\n${numbered}`,
    schema: MergedZ,
  });
  if (!result) {
    return 0;
  }
  let queued = 0;
  for (const merge of result.merged) {
    const replacedKeys = merge.replaces
      .map(n => ns.rules[n - 1]?.key)
      .filter((k): k is string => Boolean(k));
    if (replacedKeys.length < 2) {
      continue; // the model named lines that do not exist — fail closed
    }
    const candidate = await createCandidate({
      orgId,
      stepName: name,
      ruleText: merge.text,
      polarity: 'reinforce',
      memoryType: 'procedure',
    });
    await db
      .update(learningCandidateSchema)
      .set({ replacesKeys: replacedKeys })
      .where(eq(learningCandidateSchema.id, candidate.id));
    queued++;
  }
  return queued;
}

/**
 * Mine fresh episodes for candidate rules. Proposals go through
 * `recordProposedRule`, so the duplicate judge and occurrence counting apply
 * exactly as they do to human feedback.
 * @param orgId
 * @param since - Only episodes newer than this are mined.
 */
export async function mineEpisodes(orgId: string, since: Date): Promise<{ mined: number; proposed: number; latest: Date | null }> {
  const episodes = await listEpisodes(orgId, since, EPISODE_BATCH);
  if (episodes.length < 3) {
    return { mined: episodes.length, proposed: 0, latest: episodes.at(-1)?.createdAt ?? null };
  }
  const listing = episodes
    .map(e => `- [${e.agentSlug ?? 'unattributed'}] ${e.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
  const result = await judged({ orgId, name: 'mine', system: MINE_SYSTEM, user: `Episodes:\n${listing}`, schema: MinedZ });
  let proposed = 0;
  for (const rule of result?.rules ?? []) {
    const outcome = await recordProposedRule({
      orgId,
      ruleText: rule.text,
      polarity: rule.polarity ?? 'correct',
      agentSlug: rule.agent_slug ?? null,
      note: 'Proposed by consolidation from repeated run outcomes (episodes).',
      submittedBy: 'consolidation',
    });
    if (outcome.outcome === 'created') {
      proposed++;
    }
  }
  return { mined: episodes.length, proposed, latest: episodes.at(-1)?.createdAt ?? null };
}

/**
 * Draft ONE amendment proposal for a mature workflow namespace with none
 * pending — how learnings graduate toward skills/playbooks. The draft lands
 * on the review queue like everything else; applying it to the workspace YAML
 * stays a human act.
 * @param orgId
 */
export async function draftAmendments(orgId: string): Promise<number> {
  const namespaces = (await listNamespaces(orgId)).filter(ns => ns.scopeKind === 'workflow' && ns.ruleCount >= MATURITY_THRESHOLD);
  let drafted = 0;
  for (const ns of namespaces) {
    const [pending] = await db
      .select({ id: learningCandidateSchema.id })
      .from(learningCandidateSchema)
      .where(and(
        eq(learningCandidateSchema.orgId, orgId),
        eq(learningCandidateSchema.stepName, ns.name),
        eq(learningCandidateSchema.status, 'pending'),
        like(learningCandidateSchema.ruleText, 'PROCEDURE AMENDMENT:%'),
      ))
      .limit(1);
    if (pending) {
      continue;
    }
    const full = await getNamespace(orgId, ns.name);
    const result = await judged({
      orgId,
      name: 'amend',
      system: AMEND_SYSTEM,
      user: `Bucket: ${ns.title}\nRules:\n${full.rules.map(r => `- ${r.ruleText}`).join('\n')}`,
      schema: AmendZ,
    });
    if (!result) {
      continue;
    }
    await createCandidate({
      orgId,
      stepName: ns.name,
      ruleText: `PROCEDURE AMENDMENT: ${result.amendment}`,
      polarity: 'reinforce',
      memoryType: 'procedure',
    });
    drafted++;
  }
  return drafted;
}

/* ------------------------------------------------------------------ */
/* The scheduled pass                                                  */
/* ------------------------------------------------------------------ */

const STATE_KEY = '/consolidation/state.json';

type ConsolidationState = { lastRunAt?: string; lastMinedAt?: string };

async function readState(orgId: string): Promise<ConsolidationState> {
  const [row] = await db
    .select()
    .from(memorySchema)
    .where(and(eq(memorySchema.orgId, orgId), eq(memorySchema.key, STATE_KEY)));
  return (row?.value as ConsolidationState | undefined) ?? {};
}

async function writeState(orgId: string, state: ConsolidationState): Promise<void> {
  await db
    .insert(memorySchema)
    .values({ orgId, namespace: MEMORY_STORE_NAMESPACE, key: STATE_KEY, value: state })
    .onConflictDoUpdate({
      target: [memorySchema.orgId, memorySchema.namespace, memorySchema.key],
      set: { value: state, updatedAt: new Date() },
    });
}

export const CONSOLIDATION_INTERVAL_HOURS = Number(process.env.VOCION_CONSOLIDATION_INTERVAL_HOURS ?? 24);

/**
 * One full pass for one org: compaction sweep, episode mining, amendment
 * drafting. Every output is a pending candidate; nothing in the store moves
 * until a person approves.
 * @param orgId
 */
export async function runConsolidation(orgId: string): Promise<{ compactions: number; mined: number; proposed: number; amendments: number }> {
  const state = await readState(orgId);
  let compactions = 0;
  for (const ns of await listNamespaces(orgId)) {
    if (ns.scopeKind === 'run') {
      continue;
    }
    compactions += await compactNamespace(orgId, ns.name);
  }
  const since = state.lastMinedAt ? new Date(state.lastMinedAt) : new Date(0);
  const mining = await mineEpisodes(orgId, since);
  const amendments = await draftAmendments(orgId);
  await writeState(orgId, {
    lastRunAt: new Date().toISOString(),
    lastMinedAt: (mining.latest ?? since).toISOString(),
  });
  return { compactions, mined: mining.mined, proposed: mining.proposed, amendments };
}

/**
 * The worker-loop tick: run every org whose last pass is older than the
 * interval. Orgs are discovered from the namespace manifest — an org with no
 * namespaces has nothing to consolidate.
 */
export async function consolidationTick(): Promise<void> {
  const orgs = await db
    .selectDistinct({ orgId: memoryNamespaceSchema.orgId })
    .from(memoryNamespaceSchema);
  for (const { orgId } of orgs) {
    const state = await readState(orgId);
    const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
    if (Date.now() - last < CONSOLIDATION_INTERVAL_HOURS * 3_600_000) {
      continue;
    }
    try {
      const result = await runConsolidation(orgId);
      console.warn(`[consolidation] ${orgId}: ${result.compactions} merge proposal(s), ${result.proposed} mined rule(s) from ${result.mined} episode(s), ${result.amendments} amendment(s)`);
    } catch (error) {
      console.error(`[consolidation] pass failed for ${orgId}`, error);
    }
  }
}
