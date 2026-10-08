/**
 * ConsolidationService — the compaction half of the memory loop (scoped-memory
 * plan, Phase 4).
 *
 * A scheduled pass per org that:
 *   1. compacts mature namespaces — when a namespace's rule count is over
 *      budget (~30) or it holds near-duplicates, the model is shown the
 *      related rules in batches of at most 60 and proposes merges (each naming
 *      the keys it replaces) and contradicting pairs (the older rule is
 *      proposed for retirement; code reads which is older off the record);
 *   2. proposes retiring the rules nobody used — no agent mounted them and
 *      nobody restated them for `defaults.orgReview.staleRuleDays` (60) —
 *      decided by code from dated fields, one batch per namespace at a time;
 *   3. mines fresh episodes (TTL'd run outcomes) for candidate rules;
 *   4. drafts a procedure amendment when a workflow namespace matures, so
 *      learnings graduate toward skills/playbooks.
 *
 * A merge keeps what its originals earned — their occurrence counts are summed
 * onto the merged rule and each one rides along as provenance — and nothing is
 * ever deleted: a merged or retired rule is expired in the store with the
 * decision on its meta, and Undo restores it (`LearningCandidateService`).
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
 * `VOCION_CONSOLIDATION_INTERVAL_HOURS` (default 24) per org, and the weekly
 * org review (`services/orgReview`) runs it for its workspace when it is due,
 * so a deployment without the worker still compacts; the per-org cursor lives
 * in the memory table under `/consolidation/state.json`.
 * `npm run consolidate:run -- --org <id>` runs one org by hand.
 */

import type { RuleChangeEvidence } from '@/libs/learning/ruleChange';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { and, eq, gte, like, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { cleanUsageDetails, traceFor } from '@/libs/Langfuse';
import { FEATURES } from '@/libs/Langfuse/features';
import { retireLine } from '@/libs/learning/ruleChange';
import { buildChatModel } from '@/libs/llm';
import { usageMetadataOf } from '@/libs/llm/usage';
import { MEMORY_STORE_NAMESPACE } from '@/libs/memory/store';
import { DEFAULT_STALE_RULE_DAYS, resolveOrgReviewConfig } from '@/libs/orgReview/config';
import { learningCandidateSchema, memoryNamespaceSchema, memorySchema, projectSchema } from '@/models/Schema';
import { chargeModelCall } from '@/services/budget/chargeModelCall';
import { recordProposedRule } from '@/services/feedback/ruleRecorder';
import { createCandidate } from '@/services/LearningCandidateService';
import { getNamespace, lastReinforcedAt, listEpisodes, listNamespaces, ruleSnapshots, trigramJaccard, trigrams } from '@/services/MemoryService';

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

const COMPACT_SYSTEM = `You compact an AI agent's rulebook. You are given a numbered list of approved rules from ONE bucket. Propose a SMALLER set of stronger rules that preserves every behavior the originals require, and name any two rules that contradict each other.

Rules for merging:
  - Merge only rules that are about the same behavior. Never merge rules about different situations.
  - A merged rule must be a standalone instruction that, followed alone, satisfies every rule it replaces. Losing an approved behavior is the one unforgivable failure.
  - Keep a rule as-is (do not list it) when nothing merges with it.
  - Never invent behavior nobody asked for.

Rules for contradictions:
  - Two rules contradict when following one would break the other — they ask for opposite behavior in the same situation.
  - Rules about different situations, or a narrower rule refining a broader one, do not contradict.
  - Name the pair only. Do not choose which one wins.

Return STRICT JSON:
{"merged": [{"text": "the stronger combined rule", "replaces": [1, 4]}], "contradicted": [{"a": 2, "b": 7, "why": "one short sentence"}]}

"replaces" holds the NUMBERS of the input rules the new text covers (at least 2). "a" and "b" are the numbers of two contradicting rules. Return {"merged": [], "contradicted": []} when nothing should change.`;

const MergedZ = z.object({
  merged: z.array(z.object({
    text: z.string().min(1),
    // min(1) here, min(2) enforced per item in code: one malformed merge must
    // drop THAT merge, not veto the whole payload.
    replaces: z.array(z.number().int().positive()).min(1),
  })),
  // Absent from a reply that only merges — read as "no contradictions".
  contradicted: z.array(z.object({
    a: z.number().int().positive(),
    b: z.number().int().positive(),
    why: z.string().max(400).optional(),
  })).optional().default([]),
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

/** Rules shown to the model in one call. A 747-rule bucket in one prompt is a merge nobody can check. */
export const COMPACT_BATCH_RULES = 60;

/** Calls one namespace may spend in one pass; the rest waits for the next pass. */
const COMPACT_BATCHES_PER_PASS = 4;

/** Rules one stale retirement names, so the card stays readable. */
export const STALE_BATCH_RULES = 50;

/** A rule as compaction reads it. */
type LiveRule = Awaited<ReturnType<typeof getNamespace>>['rules'][number];

/**
 * A rule the workspace authors in git (`learnings/<step>.yaml`, seeded by
 * apply under `workspace:<id>`). Compaction leaves these alone: the next apply
 * writes them back, so a merge or a retirement could never stick — that
 * change belongs in the workspace files.
 * @param rule - The rule.
 * @param rule.source - Its provenance.
 */
export function isAuthoredRule(rule: { source: string | null }): boolean {
  return (rule.source ?? '').startsWith('workspace:');
}

/**
 * Related rules, grouped: every pair at or above the related threshold joins
 * one group (union-find), and groups keep the namespace's order. Each rule's
 * trigram set is built once, so a large bucket costs n² cheap overlaps rather
 * than n² set builds.
 * @param rules - The rules to group, in namespace order.
 */
export function relatedGroups<T extends { ruleText: string }>(rules: readonly T[]): T[][] {
  const sets = rules.map(r => trigrams(r.ruleText));
  const parent = rules.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (trigramJaccard(sets[i]!, sets[j]!) >= RELATED_THRESHOLD) {
        parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map<number, T[]>();
  rules.forEach((rule, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), rule]);
  });
  return [...groups.values()].filter(g => g.length > 1);
}

/**
 * What the model is shown, in calls of at most {@link COMPACT_BATCH_RULES}:
 * the related groups first, a group never split while it fits, and — for a
 * namespace over budget — the remaining rules after them, because a bucket
 * that large holds duplicates trigram overlap cannot see.
 * @param rules - The rules open to compaction, in namespace order.
 * @param overBudget - Whether the namespace holds more than its budget.
 */
export function compactionBatches<T extends { key: string; ruleText: string }>(rules: readonly T[], overBudget: boolean): T[][] {
  const groups = relatedGroups(rules);
  const grouped = new Set(groups.flat().map(r => r.key));
  const units: T[][] = [...groups];
  if (overBudget) {
    units.push(...rules.filter(r => !grouped.has(r.key)).map(r => [r]));
  }
  const batches: T[][] = [];
  let current: T[] = [];
  for (const unit of units) {
    for (let i = 0; i < unit.length; i += COMPACT_BATCH_RULES) {
      const piece = unit.slice(i, i + COMPACT_BATCH_RULES);
      if (current.length + piece.length > COMPACT_BATCH_RULES && current.length > 0) {
        batches.push(current);
        current = [];
      }
      current.push(...piece);
    }
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

/**
 * Keys a person is already deciding about, or decided to keep recently: in a
 * pending merge or retirement, or in one rejected within `keptForDays`. A key
 * here is not proposed again — one decision at a time, and "keep this" is
 * respected for the window rather than asked again tomorrow.
 * @param orgId - The workspace; another org's candidates are never read.
 * @param keptForDays - How long a "keep" stands.
 * @param now - The clock.
 */
export async function keysUnderReview(orgId: string, keptForDays: number, now: Date = new Date()): Promise<Set<string>> {
  const since = new Date(now.getTime() - keptForDays * 86_400_000);
  const rows = await db
    .select({ keys: learningCandidateSchema.replacesKeys })
    .from(learningCandidateSchema)
    .where(and(
      eq(learningCandidateSchema.orgId, orgId),
      sql`${learningCandidateSchema.replacesKeys} is not null`,
      or(
        eq(learningCandidateSchema.status, 'pending'),
        and(eq(learningCandidateSchema.status, 'rejected'), gte(learningCandidateSchema.decidedAt, since)),
      ),
    ));
  return new Set(rows.flatMap(r => r.keys ?? []));
}

/**
 * File one compaction as a pending candidate: the change, the keys it
 * retires, and the evidence it was proposed on. Nothing in the store moves.
 * @param opts - The proposal.
 * @param opts.orgId - The workspace.
 * @param opts.stepName - The namespace.
 * @param opts.kind - A merge (writes `ruleText`) or a retirement (writes nothing).
 * @param opts.ruleText - The merged rule, or the line a retirement reads as.
 * @param opts.keys - The rules it retires.
 * @param opts.evidence - What it was proposed on, minus the snapshots read here.
 * @returns The candidate id.
 */
async function fileCompaction(opts: {
  orgId: string;
  stepName: string;
  kind: 'merge' | 'expire';
  ruleText: string;
  keys: string[];
  evidence: Omit<RuleChangeEvidence, 'rules'>;
}): Promise<number> {
  const rules = await ruleSnapshots(opts.orgId, opts.keys);
  const candidate = await createCandidate({
    orgId: opts.orgId,
    stepName: opts.stepName,
    ruleText: opts.ruleText,
    polarity: 'reinforce',
    memoryType: 'procedure',
  });
  await db
    .update(learningCandidateSchema)
    .set({ replacesKeys: opts.keys, changeKind: opts.kind, evidence: { ...opts.evidence, rules } })
    .where(eq(learningCandidateSchema.id, candidate.id));
  return candidate.id;
}

/**
 * Does the namespace need compaction — over budget, or holding near-duplicates?
 * @param total - Rules the namespace holds.
 * @param open - The rules open to compaction.
 */
function needsCompaction(total: number, open: Array<{ ruleText: string }>): boolean {
  return total > NAMESPACE_BUDGET || relatedGroups(open).length > 0;
}

/**
 * Compact one namespace: merges of near-duplicates, and retirements of rules a
 * newer rule contradicts, each queued as a pending candidate carrying the keys
 * it retires and the evidence behind it. Returns how many proposals were
 * queued. A key already in a pending proposal, or kept by a person within
 * `keptForDays`, is left out; so is a rule the workspace authors in git.
 * @param orgId - The workspace.
 * @param name - Namespace name.
 * @param opts - The clock and how long a "keep" stands.
 * @param opts.now - The clock.
 * @param opts.keptForDays - How long a rejected compaction keeps its rules out (default the stale window).
 */
export async function compactNamespace(orgId: string, name: string, opts: { now?: Date; keptForDays?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const ns = await getNamespace(orgId, name);
  const blocked = await keysUnderReview(orgId, opts.keptForDays ?? DEFAULT_STALE_RULE_DAYS, now);
  const open = ns.rules.filter(r => !blocked.has(r.key) && !isAuthoredRule(r));
  if (open.length < 2 || !needsCompaction(ns.rules.length, open)) {
    return 0;
  }
  let queued = 0;
  for (const batch of compactionBatches(open, ns.rules.length > NAMESPACE_BUDGET).slice(0, COMPACT_BATCHES_PER_PASS)) {
    const numbered = batch.map((r, i) => `  ${i + 1}. ${r.ruleText.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
    const result = await judged({
      orgId,
      name: 'compact',
      system: COMPACT_SYSTEM,
      user: `Bucket: ${ns.title}\nRules:\n${numbered}`,
      schema: MergedZ,
    });
    if (!result) {
      continue; // fail closed, per batch
    }
    // A rule goes into at most one proposal per pass — two proposals over
    // the same rule are two decisions that cannot both be taken.
    const taken = new Set<string>();
    const pick = (n: number): LiveRule | undefined => batch[n - 1];
    for (const merge of result.merged) {
      const replaced = [...new Set(merge.replaces)].map(pick).filter((r): r is LiveRule => Boolean(r) && !taken.has(r!.key));
      if (replaced.length < 2) {
        continue; // the model named lines that do not exist — fail closed
      }
      replaced.forEach(r => taken.add(r.key));
      await fileCompaction({
        orgId,
        stepName: name,
        kind: 'merge',
        ruleText: merge.text,
        keys: replaced.map(r => r.key),
        evidence: { reason: 'merged', asOf: now.toISOString() },
      });
      queued++;
    }
    for (const pair of result.contradicted) {
      const a = pick(pair.a);
      const b = pick(pair.b);
      if (!a || !b || a.key === b.key || taken.has(a.key) || taken.has(b.key)) {
        continue;
      }
      // The model names the pair; the record says which is newer, and the
      // newer rule is the workspace's current word.
      const [older, newer] = a.createdAt.getTime() <= b.createdAt.getTime() ? [a, b] : [b, a];
      taken.add(older.key);
      await fileCompaction({
        orgId,
        stepName: name,
        kind: 'expire',
        ruleText: older.ruleText,
        keys: [older.key],
        evidence: {
          reason: 'contradicted',
          supersededBy: { key: newer.key, text: newer.ruleText },
          ...(pair.why ? { why: pair.why } : {}),
          asOf: now.toISOString(),
        },
      });
      queued++;
    }
  }
  return queued;
}

/**
 * Propose retiring the rules in one namespace that nobody has used: no agent
 * has had them mounted, nobody has restated them, and they were adopted
 * before the window — all three older than `staleDays`. Code decides this
 * from dated fields; no model reads anything. One pending retirement per
 * namespace at a time, of at most {@link STALE_BATCH_RULES} rules, oldest
 * first, so a bucket of hundreds is tidied over a few passes rather than in
 * one card nobody can read.
 *
 * A person's own preferences (`user` scope) are never retired for being
 * quiet — a person on holiday has not changed their mind — run episodes
 * expire on their own, and object knowledge is read through `lookup_objects`,
 * which stamps no read, so its silence proves nothing.
 * @param orgId - The workspace.
 * @param name - Namespace name.
 * @param opts - The window and the clock.
 * @param opts.staleDays - Days of silence that make a rule stale.
 * @param opts.now - The clock.
 * @returns 1 when a retirement was proposed, else 0.
 */
export async function proposeStaleRetirements(orgId: string, name: string, opts: { staleDays: number; now?: Date }): Promise<number> {
  const now = opts.now ?? new Date();
  const [nsRow] = await db
    .select({ scopeKind: memoryNamespaceSchema.scopeKind, title: memoryNamespaceSchema.title })
    .from(memoryNamespaceSchema)
    .where(and(eq(memoryNamespaceSchema.orgId, orgId), eq(memoryNamespaceSchema.name, name)))
    .limit(1);
  // Only buckets whose reads are stamped can be called unread: a person's own
  // preferences are not retired for being quiet, episodes expire on their own,
  // and object knowledge rides `lookup_objects`, which does not stamp a read.
  if (!nsRow || nsRow.scopeKind === 'user' || nsRow.scopeKind === 'run' || nsRow.scopeKind === 'object') {
    return 0;
  }
  const [pending] = await db
    .select({ id: learningCandidateSchema.id })
    .from(learningCandidateSchema)
    .where(and(
      eq(learningCandidateSchema.orgId, orgId),
      eq(learningCandidateSchema.stepName, name),
      eq(learningCandidateSchema.status, 'pending'),
      eq(learningCandidateSchema.changeKind, 'expire'),
      sql`${learningCandidateSchema.evidence} ->> 'reason' = 'stale'`,
    ))
    .limit(1);
  if (pending) {
    return 0;
  }
  const ns = await getNamespace(orgId, name);
  const blocked = await keysUnderReview(orgId, opts.staleDays, now);
  const open = ns.rules.filter(r => !blocked.has(r.key) && !isAuthoredRule(r));
  if (open.length === 0) {
    return 0;
  }
  const reinforced = await lastReinforcedAt(orgId, open.map(r => r.key));
  const stale = staleRules(open, reinforced, opts.staleDays, now).slice(0, STALE_BATCH_RULES);
  if (stale.length === 0) {
    return 0;
  }
  const evidence = { reason: 'stale' as const, staleDays: opts.staleDays, asOf: now.toISOString() };
  await fileCompaction({
    orgId,
    stepName: name,
    kind: 'expire',
    ruleText: `Retire ${retireLine({ ...evidence, rules: stale })} (${ns.title})`,
    keys: stale.map(r => r.key),
    evidence,
  });
  return 1;
}

/**
 * The rules quiet for longer than the window, quietest first. A rule's last
 * sign of life is the latest of when it was adopted, last mounted and last
 * restated; stale means that is older than `staleDays`. Pure.
 * @param rules - Live rules.
 * @param reinforced - When feedback last restated each key.
 * @param staleDays - The window.
 * @param now - The clock.
 */
export function staleRules<T extends { key: string; createdAt: Date; lastUsedAt: Date | null }>(rules: readonly T[], reinforced: ReadonlyMap<string, Date>, staleDays: number, now: Date): T[] {
  const cutoff = now.getTime() - staleDays * 86_400_000;
  const lastSign = (r: T) => Math.max(r.createdAt.getTime(), r.lastUsedAt?.getTime() ?? 0, reinforced.get(r.key)?.getTime() ?? 0);
  return rules
    .filter(r => lastSign(r) < cutoff)
    .sort((a, b) => lastSign(a) - lastSign(b));
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
 * How long this workspace waits before a quiet rule is stale — its
 * `defaults.orgReview.staleRuleDays`, else the shipped default.
 * @param orgId - The workspace.
 */
async function staleDaysFor(orgId: string): Promise<number> {
  const [row] = await db
    .select({ orgReview: projectSchema.orgReview, kind: projectSchema.kind })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  return resolveOrgReviewConfig(row?.orgReview ?? null, row?.kind ?? 'shared').staleRuleDays;
}

/**
 * One full pass for one org: compaction sweep (merges and contradictions),
 * stale retirements, episode mining, amendment drafting. Every output is a
 * pending candidate; nothing in the store moves until a person approves.
 * @param orgId - The workspace.
 * @param opts - The clock, and the stale window when the caller already read it.
 * @param opts.now - The clock.
 * @param opts.staleDays - Days of silence that make a rule stale; read from the workspace when absent.
 */
export async function runConsolidation(orgId: string, opts: { now?: Date; staleDays?: number } = {}): Promise<{ compactions: number; retirements: number; mined: number; proposed: number; amendments: number }> {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? await staleDaysFor(orgId);
  const state = await readState(orgId);
  let compactions = 0;
  let retirements = 0;
  for (const ns of await listNamespaces(orgId)) {
    if (ns.scopeKind === 'run') {
      continue;
    }
    compactions += await compactNamespace(orgId, ns.name, { now, keptForDays: staleDays });
    retirements += await proposeStaleRetirements(orgId, ns.name, { staleDays, now });
  }
  const since = state.lastMinedAt ? new Date(state.lastMinedAt) : new Date(0);
  const mining = await mineEpisodes(orgId, since);
  const amendments = await draftAmendments(orgId);
  await writeState(orgId, {
    lastRunAt: now.toISOString(),
    lastMinedAt: (mining.latest ?? since).toISOString(),
  });
  return { compactions, retirements, mined: mining.mined, proposed: mining.proposed, amendments };
}

/**
 * Whether this org's last consolidation pass is older than the interval — the
 * one test the worker tick and the weekly org review both use, so a workspace
 * with both running is still compacted once per interval.
 * @param orgId - The workspace.
 * @param now - The clock.
 */
export async function consolidationDue(orgId: string, now: Date = new Date()): Promise<boolean> {
  const state = await readState(orgId);
  const last = state.lastRunAt ? new Date(state.lastRunAt).getTime() : 0;
  return now.getTime() - last >= CONSOLIDATION_INTERVAL_HOURS * 3_600_000;
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
    if (!await consolidationDue(orgId)) {
      continue;
    }
    try {
      const result = await runConsolidation(orgId);
      console.warn(`[consolidation] ${orgId}: ${result.compactions} merge or contradiction proposal(s), ${result.retirements} stale retirement(s), ${result.proposed} mined rule(s) from ${result.mined} episode(s), ${result.amendments} amendment(s)`);
    } catch (error) {
      console.error(`[consolidation] pass failed for ${orgId}`, error);
    }
  }
}
