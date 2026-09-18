/**
 * AlignmentService — the write and read side of the alignment ledger.
 *
 * The product owner's question, 2026-09-15: "if I make these decisions, is the
 * system learning and aligning as well as getting unblocked?" This is the part
 * that makes the answer yes. Every human decision on an agent recommendation —
 * approve, reject, edit, an ask's option, "other" — lands here as one row
 * comparing what the agent advised with what the person did. The score it
 * yields ("agrees with you 92%, n=48, 30d") is shown next to the confidence
 * meter on the review card and the ask sheet, and it is the evidence the
 * autonomy ladder promotes on (`services/autonomy/AutonomyService.ts`).
 *
 * Two hooks feed it: `ReviewService.decide` (actions) and `AskService.decideAsk`
 * (asks). Both are fire-and-forget from the caller's point of view — a decision
 * a person already made must never fail because bookkeeping did.
 *
 * On agreement, every N agreed decisions per (agent, kind) queue a *reinforce*
 * learning candidate through the feedback pipeline, rate-limited to one a day
 * per kind. On a rejection of an action, the autonomy service is told, so an
 * auto-executed run that a person rejected demotes the kind on the spot.
 */

import type { ActionSignal } from '@/services/ReviewService';
import { and, eq, gte, sql } from 'drizzle-orm';
import { decisionOutcome, parseSuggestedDecision } from '@/libs/actions/suggestedDecision';
import { db } from '@/libs/DB';
import { actionRunSchema, decisionAlignmentSchema } from '@/models/Schema';
import { TIER_RULES } from '@/services/autonomy/rungs';

export type AlignmentWindow = '7d' | '30d' | 'all';
export const ALIGNMENT_WINDOWS: readonly AlignmentWindow[] = ['7d', '30d', 'all'];

/** The score a surface shows beside a confidence meter. */
export type AlignmentScore = {
  /** agreed / n, or null when nobody has decided a recommendation of this kind yet. Null, never 0 — 0 would read as "always wrong". */
  agreementRate: number | null;
  /** Decisions where something was recommended. */
  n: number;
  agreed: number;
  /** Every decision, recommended or not. */
  decided: number;
  rejected: number;
  /** Decisions that came with a note — a correction the classifier can read. */
  withNote: number;
  window: AlignmentWindow;
};

export type SubjectKind = 'action' | 'ask';

export type AlignmentDecision = {
  orgId: string;
  subjectKind: SubjectKind;
  subjectKey: string;
  subjectId: number;
  agentSlug?: string | null;
  decision: string;
  /** What the agent recommended, or null when it gave no view. */
  recommended: string | null;
  /** True when `recommended` was inferred rather than stated. */
  implicit?: boolean;
  /** The decision `recommended` is compared against — differs from `decision` when triage signals map onto verbs. */
  outcome?: string | null;
  confidence?: number | null;
  autoExecuted?: boolean;
  hasNote?: boolean;
  decidedBy?: string | null;
  at?: Date;
};

/** Every N agreed decisions per (agent, kind) propose one reinforce candidate. */
export const REINFORCE_EVERY = 10;

const DECISIONS_MEANING_REJECT = new Set(['rejected', 'reject']);

function windowStart(window: AlignmentWindow, now: Date): Date | null {
  switch (window) {
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
    default:
      return null;
  }
}

export function parseAlignmentWindow(value: unknown): AlignmentWindow {
  return ALIGNMENT_WINDOWS.includes(value as AlignmentWindow) ? value as AlignmentWindow : '30d';
}

function emptyScore(window: AlignmentWindow): AlignmentScore {
  return { agreementRate: null, n: 0, agreed: 0, decided: 0, rejected: 0, withNote: 0, window };
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

/**
 * Record one decision. Idempotent on (org, kind, subject, decision). Never
 * throws — the caller has already decided; this is the record of it.
 * @param input
 */
export async function recordDecision(input: AlignmentDecision): Promise<void> {
  const compared = input.outcome ?? input.decision;
  const agreed = input.recommended === null ? null : compared === input.recommended;
  try {
    const inserted = await db
      .insert(decisionAlignmentSchema)
      .values({
        orgId: input.orgId,
        subjectKind: input.subjectKind,
        subjectKey: input.subjectKey,
        subjectId: input.subjectId,
        agentSlug: input.agentSlug ?? null,
        decision: input.decision,
        recommended: input.recommended,
        implicit: input.implicit ?? false,
        agreed,
        confidence: input.confidence ?? null,
        autoExecuted: input.autoExecuted ?? false,
        hasNote: input.hasNote ?? false,
        decidedBy: input.decidedBy ?? null,
        ...(input.at ? { decidedAt: input.at } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: decisionAlignmentSchema.id });
    if (inserted.length === 0) {
      return;
    }
    if (agreed && input.agentSlug) {
      await proposeReinforceCandidate(input);
    }
    if (input.subjectKind === 'action' && DECISIONS_MEANING_REJECT.has(input.decision)) {
      const { noteRejection } = await import('@/services/autonomy/AutonomyService');
      await noteRejection({ orgId: input.orgId, actionId: input.subjectKey, autoExecuted: input.autoExecuted ?? false, confidence: input.confidence ?? null });
    }
  } catch (error) {
    console.warn(`[AlignmentService] could not record the decision on ${input.subjectKind} ${input.subjectId}`, error);
  }
}

/**
 * Record a review-queue decision on an action run. Reads the run itself so the
 * caller passes only what it knows: the run, the triage signal, who decided.
 *
 * Only terminal signals count — approve, edit, reject. A skip, save, rewrite
 * or regenerate leaves the item pending and decides nothing.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.signal
 * @param opts.userId
 * @param opts.hasNote
 */
export async function recordActionAlignment(opts: { orgId: string; runId: number; signal: ActionSignal; userId?: string; hasNote?: boolean }): Promise<void> {
  const decision = ({ approve: 'approved', edit: 'edited', reject: 'rejected' } as Partial<Record<ActionSignal, string>>)[opts.signal];
  if (!decision) {
    return;
  }
  try {
    const [run] = await db
      .select({ actionId: actionRunSchema.actionId, invokedBy: actionRunSchema.invokedBy, proposal: actionRunSchema.proposal })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1);
    if (!run) {
      return;
    }
    const agentSlug = run.invokedBy?.startsWith('agent:') ? run.invokedBy.slice('agent:'.length) : run.proposal?.agentSlug ?? null;
    const suggested = parseSuggestedDecision(run.proposal?.suggestedDecision);
    await recordDecision({
      orgId: opts.orgId,
      subjectKind: 'action',
      subjectKey: run.actionId,
      subjectId: opts.runId,
      agentSlug,
      decision,
      // No stated view is no recommendation, never an inferred `approve`.
      // Reading silence as approval scored every such proposal against what
      // the reviewer did, so an agent that said nothing and happened to be
      // rejected looked like an agent that had been wrong. A null keeps the
      // row as evidence a decision happened while leaving it out of the
      // agreement rate entirely: `n` counts only rows whose `recommended` is
      // not null, and `agreed` is null for the rest.
      //
      // Both producers are now required to state one (`propose_action` and
      // the candidate extractor), so a null here means a run proposed before
      // that shipped, or one written straight over the API.
      recommended: suggested ?? null,
      outcome: decisionOutcome(decision),
      confidence: typeof run.proposal?.confidence === 'number' ? run.proposal.confidence : null,
      autoExecuted: run.proposal?.autoApproved === true,
      hasNote: opts.hasNote ?? false,
      decidedBy: opts.userId ?? null,
    });
  } catch (error) {
    console.warn(`[AlignmentService] could not read action run ${opts.runId} for the alignment ledger`, error);
  }
}

/**
 * Record an answer to an ask. The recommendation is the option marked
 * `recommended`; agreeing means choosing it. An ask with no recommended option
 * is still counted as decided — it just has nothing to agree with.
 * @param opts
 * @param opts.ask
 * @param opts.ask.id
 * @param opts.ask.orgId
 * @param opts.ask.kind
 * @param opts.ask.agentSlug
 * @param opts.ask.options
 * @param opts.decision
 * @param opts.note
 * @param opts.decidedBy
 */
export async function recordAskAlignment(opts: {
  ask: { id: number; orgId: string; kind: string; agentSlug: string | null; options: Array<{ id: string; recommended?: boolean; confidence?: number }> };
  decision: string;
  note: string | null;
  decidedBy: string;
}): Promise<void> {
  const recommended = opts.ask.options.find(o => o.recommended === true) ?? null;
  await recordDecision({
    orgId: opts.ask.orgId,
    subjectKind: 'ask',
    subjectKey: opts.ask.kind,
    subjectId: opts.ask.id,
    agentSlug: opts.ask.agentSlug,
    decision: opts.decision,
    recommended: recommended?.id ?? null,
    confidence: typeof recommended?.confidence === 'number' ? recommended.confidence : null,
    hasNote: !!opts.note?.trim(),
    decidedBy: opts.decidedBy,
  });
}

/**
 * Every `REINFORCE_EVERY` agreed decisions per (agent, kind), queue one
 * reinforce candidate: "approvals of X are consistently accepted — consider
 * raising autonomy". Keyed on the day, so however many agreements land, the
 * pipeline sees at most one such job per kind per day.
 * @param input
 */
async function proposeReinforceCandidate(input: AlignmentDecision): Promise<void> {
  const [row] = await db
    .select({
      agreed: sql<number>`count(*) filter (where ${decisionAlignmentSchema.agreed} and not ${decisionAlignmentSchema.implicit})::int`,
      n: sql<number>`count(*) filter (where ${decisionAlignmentSchema.recommended} is not null and not ${decisionAlignmentSchema.implicit})::int`,
    })
    .from(decisionAlignmentSchema)
    .where(and(
      eq(decisionAlignmentSchema.orgId, input.orgId),
      eq(decisionAlignmentSchema.subjectKind, input.subjectKind),
      eq(decisionAlignmentSchema.subjectKey, input.subjectKey),
      eq(decisionAlignmentSchema.agentSlug, input.agentSlug!),
    ));
  const agreed = Number(row?.agreed ?? 0);
  const n = Number(row?.n ?? 0);
  if (agreed === 0 || agreed % REINFORCE_EVERY !== 0) {
    return;
  }
  const day = (input.at ?? new Date()).toISOString().slice(0, 10);
  const pct = n > 0 ? Math.round((agreed / n) * 100) : 100;
  const what = input.subjectKind === 'action' ? `${input.subjectKey} proposals` : `${input.subjectKey} asks`;
  const { enqueue } = await import('@/services/FeedbackWorkerService');
  await enqueue({
    orgId: input.orgId,
    source: input.subjectKind === 'action' ? 'review' : 'ask',
    externalId: `alignment:${input.subjectKind}:${input.subjectKey}:${input.agentSlug}:${day}`,
    payload: {
      text: `${what} from ${input.agentSlug} are consistently accepted: ${agreed} of ${n} decisions agreed with the recommendation (${pct}%). Keep doing what works here, and consider raising this kind's autonomy on /dashboard/autonomy.`,
      agentSlug: input.agentSlug ?? undefined,
      submittedBy: input.decidedBy ?? undefined,
      polarityHint: 'reinforce',
    },
  });
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

// Rows written before silence stopped counting as approval carry
// `implicit = true` and a `recommended` of `approve` nobody ever stated. They
// are excluded from both halves of the rate, so the number means the same
// thing across the boundary: of the recommendations an agent actually made,
// how many did a person agree with. Excluded from `agreed` as well as `n` —
// dropping them from only the denominator would push the rate above 1.
const aggregate = {
  n: sql<number>`count(*) filter (where ${decisionAlignmentSchema.recommended} is not null and not ${decisionAlignmentSchema.implicit})::int`,
  agreed: sql<number>`count(*) filter (where ${decisionAlignmentSchema.agreed} and not ${decisionAlignmentSchema.implicit})::int`,
  decided: sql<number>`count(*)::int`,
  rejected: sql<number>`count(*) filter (where ${decisionAlignmentSchema.decision} in ('rejected', 'reject'))::int`,
  withNote: sql<number>`count(*) filter (where ${decisionAlignmentSchema.hasNote})::int`,
};

function toScore(row: { n: number; agreed: number; decided: number; rejected: number; withNote: number } | undefined, window: AlignmentWindow): AlignmentScore {
  if (!row) {
    return emptyScore(window);
  }
  const n = Number(row.n);
  const agreed = Number(row.agreed);
  return {
    agreementRate: n > 0 ? agreed / n : null,
    n,
    agreed,
    decided: Number(row.decided),
    rejected: Number(row.rejected),
    withNote: Number(row.withNote),
    window,
  };
}

/**
 * The score for one (agent, kind), or for a kind across every agent when
 * `agentSlug` is omitted.
 * @param opts
 * @param opts.orgId
 * @param opts.subjectKey
 * @param opts.agentSlug
 * @param opts.window
 * @param opts.now
 */
export async function scoreFor(opts: { orgId: string; subjectKey: string; agentSlug?: string | null; window?: AlignmentWindow; now?: Date }): Promise<AlignmentScore> {
  const window = opts.window ?? '30d';
  const since = windowStart(window, opts.now ?? new Date());
  const [row] = await db
    .select(aggregate)
    .from(decisionAlignmentSchema)
    .where(and(
      eq(decisionAlignmentSchema.orgId, opts.orgId),
      eq(decisionAlignmentSchema.subjectKey, opts.subjectKey),
      opts.agentSlug ? eq(decisionAlignmentSchema.agentSlug, opts.agentSlug) : undefined,
      since ? gte(decisionAlignmentSchema.decidedAt, since) : undefined,
    ));
  return toScore(row, window);
}

/**
 * Key for {@link scoresByAgentAndKey}: `<agent slug> <subject key>` — neither side can contain a space.
 * @param agentSlug
 * @param subjectKey
 */
export const agentKeyOf = (agentSlug: string | null | undefined, subjectKey: string): string => `${agentSlug ?? ''} ${subjectKey}`;

/**
 * The inverse of {@link agentKeyOf}; an empty agent slug means "no agent".
 * @param key
 */
export function splitAgentKey(key: string): [agentSlug: string, subjectKey: string] {
  const i = key.indexOf(' ');
  return [key.slice(0, i), key.slice(i + 1)];
}

/**
 * One score per (agent, kind) in the window — a single scan, for surfaces
 * that show many items at once (the review feed, the team report).
 * @param orgId
 * @param window
 * @param now
 * @param subjectKind - Narrow to actions or asks; both when omitted.
 */
export async function scoresByAgentAndKey(orgId: string, window: AlignmentWindow = '30d', now: Date = new Date(), subjectKind?: SubjectKind): Promise<Map<string, AlignmentScore>> {
  const since = windowStart(window, now);
  const rows = await db
    .select({ agentSlug: decisionAlignmentSchema.agentSlug, subjectKey: decisionAlignmentSchema.subjectKey, ...aggregate })
    .from(decisionAlignmentSchema)
    .where(and(
      eq(decisionAlignmentSchema.orgId, orgId),
      subjectKind ? eq(decisionAlignmentSchema.subjectKind, subjectKind) : undefined,
      since ? gte(decisionAlignmentSchema.decidedAt, since) : undefined,
    ))
    .groupBy(decisionAlignmentSchema.agentSlug, decisionAlignmentSchema.subjectKey);
  return new Map(rows.map(r => [agentKeyOf(r.agentSlug, r.subjectKey), toScore(r, window)]));
}

/**
 * One score per kind across every agent, in the window.
 * @param orgId
 * @param window
 * @param now
 */
export async function scoresByKey(orgId: string, window: AlignmentWindow = '30d', now: Date = new Date()): Promise<Map<string, AlignmentScore>> {
  const since = windowStart(window, now);
  const rows = await db
    .select({ subjectKey: decisionAlignmentSchema.subjectKey, ...aggregate })
    .from(decisionAlignmentSchema)
    .where(and(eq(decisionAlignmentSchema.orgId, orgId), since ? gte(decisionAlignmentSchema.decidedAt, since) : undefined))
    .groupBy(decisionAlignmentSchema.subjectKey);
  return new Map(rows.map(r => [r.subjectKey, toScore(r, window)]));
}

/**
 * The evidence the ladder promotes on, for one action kind: the 30-day
 * agreement numbers plus the rejections in the tier's own rejection window.
 * @param opts
 * @param opts.orgId
 * @param opts.actionId
 * @param opts.tier
 * @param opts.minConfidence - The confidence floor, for "high-confidence rejection".
 * @param opts.now
 */
export async function evidenceFor(opts: { orgId: string; actionId: string; tier: keyof typeof TIER_RULES; minConfidence: number; now?: Date }) {
  const now = opts.now ?? new Date();
  const rule = TIER_RULES[opts.tier];
  const windowDays = 30;
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const rejectionsSince = new Date(now.getTime() - rule.rejectionWindowDays * 86_400_000);
  const base = and(
    eq(decisionAlignmentSchema.orgId, opts.orgId),
    eq(decisionAlignmentSchema.subjectKind, 'action'),
    eq(decisionAlignmentSchema.subjectKey, opts.actionId),
  );
  const [[agreement], [rejections]] = await Promise.all([
    db.select({ n: aggregate.n, agreed: aggregate.agreed }).from(decisionAlignmentSchema).where(and(base, gte(decisionAlignmentSchema.decidedAt, since))),
    db.select({
      rejections: sql<number>`count(*)::int`,
      highConfidence: sql<number>`count(*) filter (where ${decisionAlignmentSchema.confidence} >= ${opts.minConfidence})::int`,
      autoExecuted: sql<number>`count(*) filter (where ${decisionAlignmentSchema.autoExecuted})::int`,
    }).from(decisionAlignmentSchema).where(and(
      base,
      sql`${decisionAlignmentSchema.decision} in ('rejected', 'reject')`,
      gte(decisionAlignmentSchema.decidedAt, rejectionsSince),
    )),
  ]);
  const n = Number(agreement?.n ?? 0);
  const agreed = Number(agreement?.agreed ?? 0);
  return {
    n,
    agreed,
    agreementRate: n > 0 ? agreed / n : null,
    rejections: Number(rejections?.rejections ?? 0),
    highConfidenceRejections: Number(rejections?.highConfidence ?? 0),
    autoExecutedRejections: Number(rejections?.autoExecuted ?? 0),
    windowDays,
  };
}
