import type { DefaultFacts, DefaultVerdict } from '@/libs/needsYou/deadlines';
import type { AskOption } from '@/models/Schema';
import type { RiskTier } from '@/services/autonomy/rungs';
import type { OwnerCache, OwnerSource } from '@/services/needsYou/owner';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import {
  clockFor,
  deadlineDistance,
  DECISION_WINDOW_HOURS,
  DEFAULT_DECIDER,
  defaultVerdict,
  MIN_NOTICE_MS,
  NOTICE_SHARE,
  PROPOSAL_DEFAULTS,
  RE_ESCALATE_MS,
  riskTierOf,
} from '@/libs/needsYou/deadlines';
import { actionRunSchema, askSchema, decisionDeadlineSchema, reviewAssignmentSchema } from '@/models/Schema';
import { DEFAULT_RUNG, RISK_TIERS, rungIndex } from '@/services/autonomy/rungs';
import { decisionOwner, newOwnerCache } from '@/services/needsYou/owner';

/**
 * DecisionClockService — the clock on every decision waiting on Needs you, and
 * the sweep that keeps it.
 *
 * Every five minutes (`needs-you.sweep`, a deployment schedule) the sweep:
 *
 *   1. OPENS a clock for every open ask and pending proposal that has none:
 *      its deadline (the asker's `dueAt`, else a window by risk), when its
 *      owner hears about it, and its default — the recommended option, or a
 *      proposal's own suggested decision (`libs/needsYou/deadlines.ts`).
 *   2. ESCALATES what is due to be told, before its deadline, to the person
 *      accountable for it (`owner.ts`): one `decision.escalated` event per
 *      person per sweep, however many decisions it covers, which the core
 *      notification kind turns into one notification on the existing path.
 *   3. At the deadline, APPLIES the default as a recorded decision — decided
 *      by `by-default`, with its reason on the record and Undo where the kind
 *      has one — when the trust ladder allows it or the default can be
 *      undone. Otherwise the decision is HELD: it stays on Needs you, says why,
 *      and is escalated again a day later. Nothing is dropped, and nothing
 *      runs that the ladder keeps for a person.
 *   4. SETTLES the clock of anything a person (or the asker) decided.
 *
 * Every read and write is scoped by org; the sweep itself runs deployment-wide
 * or for one org. A row that cannot be processed says why on the row and is
 * tried again in fifteen minutes, so a failure is visible and heals.
 */

export type DecisionClock = typeof decisionDeadlineSchema.$inferSelect;

/** The event an escalation raises — subscribable by automations, and the core notification kind's trigger. */
export const DECISION_ESCALATED = 'decision.escalated';

/** Payload of `decision.escalated`: one per person per sweep. Scalars, so `when.filter` can match any of them. */
export type DecisionEscalatedPayload = {
  /** Who is being told — the accountable owner (`owner.ts`). */
  ownerUserId: string;
  ownerSource: OwnerSource;
  /** How many decisions this covers. */
  count: number;
  /** …of which: due before their default applies, past their deadline and still waiting, applied by default. */
  dueSoon: number;
  held: number;
  applied: number;
  /** One sentence the notification leads with. */
  title: string;
  /** One line per decision. */
  body: string;
  /** App path to open: the queue. */
  link: string;
  /** What makes two of these the same notification. */
  dedupe: string;
};

/** A retry for a row the sweep could not process. */
const RETRY_MS = 15 * 60_000;

/** At most this many rows per sweep pass, so one busy deployment never holds the job for long. */
const SWEEP_LIMIT = 500;

/** At most this many lines in one escalation; the rest are counted. */
const MAX_LINES = 10;

type Ask = typeof askSchema.$inferSelect;
type ActionRun = typeof actionRunSchema.$inferSelect;

/**
 * The one recommended option, or null when none (or, malformed, several) is.
 * @param options - The ask's options.
 */
function recommendedOption(options: readonly AskOption[]): AskOption | null {
  const recs = options.filter(o => o.recommended === true);
  return recs.length === 1 ? recs[0]! : null;
}

/**
 * The higher of two risk tiers.
 * @param a - One tier.
 * @param b - The other.
 */
function higherTier(a: RiskTier, b: RiskTier): RiskTier {
  return RISK_TIERS.indexOf(a) >= RISK_TIERS.indexOf(b) ? a : b;
}

/**
 * How long before the deadline the owner hears, for a risk tier.
 * @param risk - The decision's risk tier.
 */
function noticeFor(risk: RiskTier): number {
  return Math.max(MIN_NOTICE_MS, DECISION_WINDOW_HOURS[risk] * 60 * 60_000 * NOTICE_SHARE);
}

function proposalDefault(proposal: ActionRun['proposal']): 'approve' | 'reject' | null {
  const s = proposal?.suggestedDecision;
  return s === 'approve' || s === 'reject' ? s : null;
}

/** A per-sweep memo of each kind's risk tier, so the same kind is read once. */
type TierCache = Map<string, Promise<RiskTier>>;

async function proposalTier(orgId: string, run: Pick<ActionRun, 'actionId' | 'input'>, cache: TierCache): Promise<RiskTier> {
  const { policyKeyForRun } = await import('@/libs/actions/policyKey');
  const key = policyKeyForRun(run.actionId, run.input);
  const memo = `${orgId}|${key}`;
  let hit = cache.get(memo);
  if (!hit) {
    hit = import('@/services/autonomy/AutonomyService').then(m => m.effectivePolicy(orgId, key)).then(p => p.riskTier);
    cache.set(memo, hit);
  }
  return hit;
}

/* ------------------------------------------------------------------ */
/* 1. Opening clocks                                                    */
/* ------------------------------------------------------------------ */

/**
 * Open a clock for every open ask and pending proposal that has none. Safe to
 * run any time; a clock already open is never moved.
 * @param opts - Scope and clock.
 * @param opts.orgId - One workspace, or every one when omitted.
 * @param opts.now - The clock.
 * @returns How many clocks were opened.
 */
export async function openClocks(opts: { orgId?: string; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const tiers: TierCache = new Map();
  const askJoin = and(
    eq(decisionDeadlineSchema.orgId, askSchema.orgId),
    eq(decisionDeadlineSchema.subjectKind, 'ask'),
    eq(decisionDeadlineSchema.subjectId, askSchema.id),
  );
  const asks = await db
    .select({ ask: askSchema })
    .from(askSchema)
    .leftJoin(decisionDeadlineSchema, askJoin)
    .where(and(opts.orgId ? eq(askSchema.orgId, opts.orgId) : undefined, eq(askSchema.status, 'open'), isNull(decisionDeadlineSchema.id)))
    .orderBy(asc(askSchema.id))
    .limit(SWEEP_LIMIT);
  const runJoin = and(
    eq(decisionDeadlineSchema.orgId, actionRunSchema.orgId),
    eq(decisionDeadlineSchema.subjectKind, 'proposal'),
    eq(decisionDeadlineSchema.subjectId, actionRunSchema.id),
  );
  const runs = await db
    .select({ run: actionRunSchema })
    .from(actionRunSchema)
    .leftJoin(decisionDeadlineSchema, runJoin)
    .where(and(opts.orgId ? eq(actionRunSchema.orgId, opts.orgId) : undefined, eq(actionRunSchema.status, 'pending'), isNull(decisionDeadlineSchema.id)))
    .orderBy(asc(actionRunSchema.id))
    .limit(SWEEP_LIMIT);

  const rows: Array<typeof decisionDeadlineSchema.$inferInsert> = [];
  for (const { ask } of asks) {
    const risk = riskTierOf(ask.risk);
    const { deadlineAt, escalateAt } = clockFor({ createdAt: ask.createdAt, dueAt: ask.dueAt, risk, now });
    const rec = recommendedOption(ask.options ?? []);
    rows.push({ orgId: ask.orgId, subjectKind: 'ask', subjectId: ask.id, deadlineAt, escalateAt, nextAt: escalateAt, defaultOption: rec?.id ?? null, defaultLabel: rec?.label ?? null, createdAt: now, updatedAt: now });
  }
  for (const { run } of runs) {
    const risk = await proposalTier(run.orgId, run, tiers).catch((): RiskTier => 'high');
    const { deadlineAt, escalateAt } = clockFor({ createdAt: run.createdAt, risk, now });
    const def = proposalDefault(run.proposal);
    rows.push({ orgId: run.orgId, subjectKind: 'proposal', subjectId: run.id, deadlineAt, escalateAt, nextAt: escalateAt, defaultOption: def, defaultLabel: def ? PROPOSAL_DEFAULTS[def] : null, createdAt: now, updatedAt: now });
  }
  if (rows.length === 0) {
    return 0;
  }
  const inserted = await db
    .insert(decisionDeadlineSchema)
    .values(rows)
    .onConflictDoNothing({ target: [decisionDeadlineSchema.orgId, decisionDeadlineSchema.subjectKind, decisionDeadlineSchema.subjectId] })
    .returning({ id: decisionDeadlineSchema.id });
  return inserted.length;
}

/* ------------------------------------------------------------------ */
/* 2–4. The due pass                                                    */
/* ------------------------------------------------------------------ */

/** What one decision is, as the due pass needs it. */
type Subject
  = | { kind: 'ask'; waiting: boolean; title: string; teamSlug: string | null; agentSlug: string | null; snoozedUntil: null; ask: Ask }
    | { kind: 'proposal'; waiting: boolean; title: string; teamSlug: null; agentSlug: string | null; snoozedUntil: Date | null; run: ActionRun; regenerating: boolean };

async function loadSubject(row: DecisionClock, now: Date): Promise<Subject | null> {
  if (row.subjectKind === 'ask') {
    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, row.orgId), eq(askSchema.id, row.subjectId))).limit(1);
    if (!ask) {
      return null;
    }
    return { kind: 'ask', waiting: ask.status === 'open', title: ask.title, teamSlug: ask.teamSlug, agentSlug: ask.agentSlug, snoozedUntil: null, ask };
  }
  const [hit] = await db
    .select({ run: actionRunSchema, snoozedUntil: reviewAssignmentSchema.snoozedUntil })
    .from(actionRunSchema)
    .leftJoin(reviewAssignmentSchema, and(eq(reviewAssignmentSchema.orgId, actionRunSchema.orgId), eq(reviewAssignmentSchema.kind, 'action'), eq(reviewAssignmentSchema.runId, actionRunSchema.id)))
    .where(and(eq(actionRunSchema.orgId, row.orgId), eq(actionRunSchema.id, row.subjectId)))
    .limit(1);
  if (!hit) {
    return null;
  }
  const { run } = hit;
  const expired = run.expiresAt !== null && run.expiresAt <= now;
  const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
  const { reviewRowById } = await import('@/services/inbox/reviewRows');
  const described = await reviewRowById(row.orgId, run.id).catch(() => null);
  return {
    kind: 'proposal',
    waiting: run.status === 'pending' && !expired,
    title: described?.described.title ?? run.actionId,
    teamSlug: null,
    agentSlug: run.proposal?.agentSlug ?? (run.invokedBy?.startsWith('agent:') ? run.invokedBy.slice(6) : null),
    snoozedUntil: hit.snoozedUntil ?? null,
    run,
    regenerating: isRegeneratingFresh(run.regeneratingSince, now),
  };
}

/**
 * The facts the deadline verdict reads, for one decision. A recommended
 * option that carries an action is judged as that action: its kind's rung,
 * risk, reversibility and holds. A plain answer is reversible — Undo reopens
 * the question — and is judged by its own risk; the ladder for `ask.file`
 * can only keep it back (a workspace that parked its agents' questions below
 * the default), never release it, because a kind trusted to ASK has not been
 * trusted to ANSWER.
 * @param row - The clock.
 * @param subject - The decision.
 */
async function factsFor(row: DecisionClock, subject: Subject): Promise<DefaultFacts> {
  const base = { defaultOption: row.defaultOption, undone: row.undoneAt !== null, escalations: row.escalations };
  const { effectivePolicy } = await import('@/services/autonomy/AutonomyService');
  const { isNeverAuto } = await import('@/libs/actions/neverAuto');
  const { policyKeyForRun } = await import('@/libs/actions/policyKey');
  const { getAction } = await import('@/libs/actions/registry');

  const judgeAction = async (actionId: string, input: Record<string, unknown>, floorTier: RiskTier): Promise<DefaultFacts> => {
    const action = getAction(actionId);
    if (!action) {
      return { ...base, inert: false, neverAuto: false, heldForPerson: `${actionId} is not a registered action here`, rung: DEFAULT_RUNG, riskTier: 'high', reversible: false };
    }
    const policy = await effectivePolicy(row.orgId, policyKeyForRun(action.id, input));
    const held = action.holdForPerson
      ? await action.holdForPerson({ orgId: row.orgId }, input).catch(() => 'its hold could not be read, so it waits for a person')
      : null;
    return {
      ...base,
      inert: false,
      neverAuto: isNeverAuto(action),
      heldForPerson: held,
      rung: policy.rung,
      riskTier: higherTier(policy.riskTier, floorTier),
      reversible: action.undo !== undefined || action.manual?.reversible === true,
    };
  };

  if (subject.kind === 'proposal') {
    if (row.defaultOption === 'reject') {
      return { ...base, inert: true, neverAuto: false, heldForPerson: null, rung: DEFAULT_RUNG, riskTier: 'low', reversible: false };
    }
    return judgeAction(subject.run.actionId, subject.run.input ?? {}, 'low');
  }
  const option = (subject.ask.options ?? []).find(o => o.id === row.defaultOption);
  const askTier = riskTierOf(subject.ask.risk);
  if (!option) {
    return { ...base, defaultOption: null, inert: false, neverAuto: false, heldForPerson: null, rung: DEFAULT_RUNG, riskTier: askTier, reversible: false };
  }
  if (option.action) {
    return judgeAction(option.action.id, option.action.input ?? {}, askTier);
  }
  const asking = await effectivePolicy(row.orgId, 'ask.file');
  return {
    ...base,
    inert: false,
    neverAuto: false,
    heldForPerson: null,
    rung: rungIndex(asking.rung) < rungIndex(DEFAULT_RUNG) ? asking.rung : DEFAULT_RUNG,
    riskTier: askTier,
    reversible: true,
  };
}

/** One line of an escalation, gathered per owner. */
type Line = { phase: 'due' | 'held' | 'applied' | 'failed'; text: string };

type Pending = Map<string, { orgId: string; userId: string; source: OwnerSource; lines: Line[] }>;

function lineFor(phase: Line['phase'], subject: Subject, row: DecisionClock, now: Date, reason?: string): Line {
  const name = `“${subject.title}”`;
  switch (phase) {
    case 'due':
      return { phase, text: row.defaultLabel ? `${name} is due ${deadlineDistance(row.deadlineAt, now)} — then ${row.defaultLabel} applies unless you answer` : `${name} is due ${deadlineDistance(row.deadlineAt, now)} and has no default — it waits for you` };
    case 'held':
      return { phase, text: `${name} is past its deadline and still needs you: ${reason ?? 'held for a person'}` };
    case 'applied':
      return { phase, text: `${name}: ${row.defaultLabel ?? 'the default'} applied by default — ${reason ?? ''}`.replace(/ — $/, '') };
    default:
      return { phase, text: `${name}: the default could not be carried out — ${reason ?? 'no reason was given'}` };
  }
}

async function queueEscalation(pending: Pending, owners: OwnerCache, row: DecisionClock, subject: Subject, line: Line): Promise<{ ownerUserId: string | null; ownerSource: OwnerSource }> {
  const owner = await decisionOwner(row.orgId, { teamSlug: subject.teamSlug, agentSlug: subject.agentSlug }, owners);
  for (const userId of owner.userIds) {
    const key = `${row.orgId}|${userId}`;
    const entry = pending.get(key) ?? { orgId: row.orgId, userId, source: owner.source, lines: [] };
    entry.lines.push(line);
    pending.set(key, entry);
  }
  return { ownerUserId: owner.userIds[0] ?? null, ownerSource: owner.source };
}

/**
 * Raise one `decision.escalated` per person: the queue is the source of
 * truth, the notification is how they hear it needs them. Never throws — an
 * event that could not be raised is logged, and the decision is still on
 * Needs you where it always was.
 * @param pending - The lines, per person.
 * @param now - The clock.
 */
async function raiseEscalations(pending: Pending, now: Date): Promise<number> {
  let raised = 0;
  const stamp = now.toISOString().slice(0, 16);
  for (const entry of pending.values()) {
    const count = entry.lines.length;
    const tally = (p: Line['phase']) => entry.lines.filter(l => l.phase === p).length;
    const dueSoon = tally('due');
    const held = tally('held');
    const applied = tally('applied');
    const failed = tally('failed');
    const only = entry.lines[0]!;
    const title = count === 1
      ? only.text
      : [
          dueSoon > 0 ? `${dueSoon} due soon` : null,
          held > 0 ? `${held} past their deadline` : null,
          applied > 0 ? `${applied} applied by default` : null,
          failed > 0 ? `${failed} could not be carried out` : null,
        ].filter(Boolean).join(', ').replace(/^/, `${count} decisions need you: `);
    const shown = entry.lines.slice(0, MAX_LINES).map(l => `• ${l.text}`);
    const more = count > MAX_LINES ? [`… and ${count - MAX_LINES} more on Needs you.`] : [];
    const payload: DecisionEscalatedPayload = {
      ownerUserId: entry.userId,
      ownerSource: entry.source,
      count,
      dueSoon,
      held,
      applied,
      title,
      body: [...shown, ...more].join('\n'),
      link: '/dashboard/inbox',
      dedupe: `${entry.userId}:${stamp}`,
    };
    try {
      const { emitEvent } = await import('@/services/EventService');
      await emitEvent({ orgId: entry.orgId, type: DECISION_ESCALATED, payload, dedupeKey: `${DECISION_ESCALATED}:${entry.userId}:${stamp}`, invokedBy: 'needs-you-sweep' });
      raised += 1;
    } catch (err) {
      console.warn('[needs-you] an escalation could not be raised; the decisions are still on Needs you', { orgId: entry.orgId, userId: entry.userId, error: (err as Error).message });
    }
  }
  return raised;
}

async function patchClock(id: number, values: Partial<typeof decisionDeadlineSchema.$inferInsert>, now: Date): Promise<void> {
  await db.update(decisionDeadlineSchema).set({ ...values, updatedAt: now }).where(eq(decisionDeadlineSchema.id, id));
}

/**
 * The ladder's `approve` released by default: stamped so the decided tab reads "applied by default", with Undo where the kind has one.
 * @param orgId - The workspace.
 * @param runId - The released run.
 * @param reason - Why the default applied.
 * @param now - The clock.
 */
async function stampDefaultRelease(orgId: string, runId: number, reason: string, now: Date): Promise<void> {
  const [run] = await db.select({ proposal: actionRunSchema.proposal }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, runId))).limit(1);
  await db
    .update(actionRunSchema)
    .set({
      // Released without a person — counted with what the ladder got through,
      // so an Undo of it is read as the strongest signal it was wrong.
      approvedByAgent: true,
      decidedBy: DEFAULT_DECIDER,
      decidedAt: now,
      proposal: { ...(run?.proposal ?? {}), autoApproved: true, autoApprovedReason: `applied by default at its deadline: ${reason}`, autoApprovedBy: 'deadline' } as never,
    })
    .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, runId)));
}

/**
 * Carry the default out. Returns null when it applied, or the reason it
 * could not — which the caller records and escalates; the decision is never
 * left half-decided without saying so.
 * @param row - The clock.
 * @param subject - The decision.
 * @param verdict - Why it may apply.
 * @param now - The clock.
 */
async function applyDefault(row: DecisionClock, subject: Subject, verdict: DefaultVerdict, now: Date): Promise<{ applied: boolean; problem: string | null }> {
  const when = row.deadlineAt.toISOString().slice(0, 16).replace('T', ' ');
  if (subject.kind === 'ask') {
    const option = (subject.ask.options ?? []).find(o => o.id === row.defaultOption)!;
    const { decideAsk } = await import('@/services/AskService');
    await decideAsk({
      orgId: row.orgId,
      id: subject.ask.id,
      decision: option.id,
      decidedBy: DEFAULT_DECIDER,
      note: `Applied by default at its deadline (${when} UTC): ${verdict.reason}. Undo reopens it.`,
    });
    if (!option.action) {
      return { applied: true, problem: null };
    }
    // The option's action, proposed as the agent that asked and released on
    // the verdict that allowed it — the ladder, its precheck and its Undo all
    // apply, exactly as for a proposal.
    try {
      const { executeAction, proposeAction } = await import('@/services/ActionService');
      const agent = subject.agentSlug;
      const res = await proposeAction({
        orgId: row.orgId,
        actionId: option.action.id,
        input: option.action.input ?? {},
        principal: { kind: 'agent', id: agent ? `agent:${agent}` : 'agent:unknown', scope: { orgId: row.orgId }, grants: ['*'], autonomy: 2 },
        invokedBy: agent ? `agent:${agent}` : DEFAULT_DECIDER,
        proposal: { confidence: option.confidence ?? 1, rationale: `Ask #${subject.ask.id} answered by default: ${option.label}`, agentSlug: agent ?? undefined, suggestedDecision: 'approve', suggestedDecisionReason: 'The recommended answer applied at the deadline.' },
      } as never) as { runId: number; status: string; error?: string };
      const done = res.status === 'pending' ? await executeAction(res.runId, row.orgId, { reviewedBy: DEFAULT_DECIDER }) as { status: string; error?: string } : res;
      if (res.status === 'pending') {
        await stampDefaultRelease(row.orgId, res.runId, verdict.reason, now);
      }
      if (done.status === 'failed') {
        return { applied: true, problem: `${option.label}: ${done.error ?? 'its action failed'}` };
      }
      return { applied: true, problem: null };
    } catch (err) {
      return { applied: true, problem: `${option.label}: could not start — ${(err as Error).message}` };
    }
  }
  const { executeAction, rejectAction } = await import('@/services/ActionService');
  if (row.defaultOption === 'reject') {
    await rejectAction(subject.run.id, row.orgId, `Declined by default at its deadline (${when} UTC): ${verdict.reason}.`, { reviewedBy: DEFAULT_DECIDER });
    return { applied: true, problem: null };
  }
  const outcome = await executeAction(subject.run.id, row.orgId, { reviewedBy: DEFAULT_DECIDER });
  await stampDefaultRelease(row.orgId, subject.run.id, verdict.reason, now);
  return { applied: true, problem: outcome.status === 'failed' ? (outcome.error ?? 'its execution failed') : null };
}

export type SweepResult = {
  opened: number;
  escalated: number;
  applied: number;
  held: number;
  settled: number;
  /** Events raised — one per person told. */
  notified: number;
  /** Rows the sweep could not process, with why; each is retried. */
  errors: Array<{ id: number; error: string }>;
};

/**
 * One pass of the clock: open what is new, then escalate, apply, hold or
 * settle every row that is due.
 * @param opts - Scope and clock.
 * @param opts.orgId - One workspace, or every one when omitted.
 * @param opts.now - The clock.
 */
export async function sweepDecisionClocks(opts: { orgId?: string; now?: Date } = {}): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const result: SweepResult = { opened: 0, escalated: 0, applied: 0, held: 0, settled: 0, notified: 0, errors: [] };
  result.opened = await openClocks({ orgId: opts.orgId, now });

  const due = await db
    .select()
    .from(decisionDeadlineSchema)
    .where(and(
      opts.orgId ? eq(decisionDeadlineSchema.orgId, opts.orgId) : undefined,
      inArray(decisionDeadlineSchema.status, ['open', 'held']),
      lte(decisionDeadlineSchema.nextAt, now),
    ))
    .orderBy(asc(decisionDeadlineSchema.nextAt))
    .limit(SWEEP_LIMIT);

  const owners = newOwnerCache();
  const pending: Pending = new Map();
  for (const row of due) {
    try {
      await processRow(row, now, owners, pending, result);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      result.errors.push({ id: row.id, error: message });
      console.warn('[needs-you] a decision clock could not be processed; retrying shortly', { id: row.id, orgId: row.orgId, error: message });
      await patchClock(row.id, { nextAt: new Date(now.getTime() + RETRY_MS), outcomeReason: `the sweep could not process it: ${message}`.slice(0, 500) }, now).catch(() => {});
    }
  }
  result.notified = await raiseEscalations(pending, now);
  return result;
}

async function processRow(row: DecisionClock, now: Date, owners: OwnerCache, pending: Pending, result: SweepResult): Promise<void> {
  const subject = await loadSubject(row, now);
  if (!subject || !subject.waiting) {
    // Decided, withdrawn, expired or gone: the clock stops.
    await patchClock(row.id, { status: 'settled' }, now);
    result.settled += 1;
    return;
  }
  if (subject.snoozedUntil && subject.snoozedUntil > now) {
    // A person said "later": the clock waits with them.
    await patchClock(row.id, { nextAt: subject.snoozedUntil }, now);
    return;
  }
  const escalate = async (line: Line) => {
    const owner = await queueEscalation(pending, owners, row, subject, line);
    result.escalated += 1;
    return { escalations: row.escalations + 1, lastEscalatedAt: now, ownerUserId: owner.ownerUserId, ownerSource: owner.ownerSource };
  };

  if (now < row.deadlineAt) {
    // Before the deadline: tell the owner (once per round), then wait for it.
    const stale = row.lastEscalatedAt === null || now.getTime() - row.lastEscalatedAt.getTime() >= RE_ESCALATE_MS;
    const told = stale ? await escalate(lineFor('due', subject, row, now)) : {};
    await patchClock(row.id, { ...told, nextAt: row.deadlineAt }, now);
    return;
  }
  if (row.escalations < 1) {
    // Never told — the deadline moves to give a full notice. Nothing applies unannounced.
    const risk = subject.kind === 'ask' ? riskTierOf(subject.ask.risk) : 'low';
    const deadlineAt = new Date(now.getTime() + noticeFor(risk));
    const moved = { ...row, deadlineAt };
    const told = await escalate(lineFor('due', subject, moved, now));
    await patchClock(row.id, { ...told, deadlineAt, nextAt: deadlineAt }, now);
    return;
  }
  if (subject.kind === 'proposal' && subject.regenerating) {
    // A new version is being drafted; deciding now would decide the old copy.
    await patchClock(row.id, { nextAt: new Date(now.getTime() + RETRY_MS) }, now);
    return;
  }

  const verdict = defaultVerdict(await factsFor(row, subject));
  if (verdict.mode === 'apply') {
    const { readWorkspacePause } = await import('@/services/workspacePause');
    if (verdict.basis !== 'inert' && await readWorkspacePause(row.orgId)) {
      // The off switch holds everything the workspace does by itself.
      await patchClock(row.id, { status: 'held', outcomeReason: 'the workspace is paused, so the default waits', nextAt: new Date(now.getTime() + RE_ESCALATE_MS) }, now);
      result.held += 1;
      return;
    }
    const { problem } = await applyDefault(row, subject, verdict, now);
    await patchClock(row.id, { status: 'applied', appliedAt: now, outcomeReason: problem ? `${verdict.reason}; then: ${problem}` : verdict.reason }, now);
    result.applied += 1;
    // The owner hears it applied — and, louder, when carrying it out failed.
    const told = await escalate(problem ? lineFor('failed', subject, row, now, problem) : lineFor('applied', subject, row, now, verdict.reason));
    await patchClock(row.id, told, now);
    return;
  }
  // Held: it stays on Needs you, says why, and is escalated again tomorrow.
  const told = await escalate(lineFor('held', subject, row, now, verdict.reason));
  await patchClock(row.id, { ...told, status: 'held', outcomeReason: verdict.reason, nextAt: new Date(now.getTime() + RE_ESCALATE_MS) }, now);
  result.held += 1;
}

/* ------------------------------------------------------------------ */
/* Reads and undo                                                       */
/* ------------------------------------------------------------------ */

/** A clock as a row on Needs you reads it. */
export type ClockView = {
  deadlineAt: Date;
  defaultLabel: string | null;
  status: 'open' | 'held';
  reason: string | null;
};

/**
 * The running clocks of one workspace, keyed `ask:<id>` / `proposal:<id>` —
 * what the rows on Needs you show beside each decision.
 * @param orgId - The workspace.
 */
export async function runningClocks(orgId: string): Promise<Map<string, ClockView>> {
  const rows = await db
    .select({ kind: decisionDeadlineSchema.subjectKind, id: decisionDeadlineSchema.subjectId, deadlineAt: decisionDeadlineSchema.deadlineAt, defaultLabel: decisionDeadlineSchema.defaultLabel, status: decisionDeadlineSchema.status, reason: decisionDeadlineSchema.outcomeReason })
    .from(decisionDeadlineSchema)
    .where(and(eq(decisionDeadlineSchema.orgId, orgId), inArray(decisionDeadlineSchema.status, ['open', 'held'])));
  return new Map(rows.map(r => [`${r.kind}:${r.id}`, { deadlineAt: r.deadlineAt, defaultLabel: r.defaultLabel, status: r.status as 'open' | 'held', reason: r.status === 'held' ? r.reason : null }]));
}

/**
 * One decision's clock, or null when it has none in this workspace.
 * @param orgId - The workspace.
 * @param subjectKind - `ask` or `proposal`.
 * @param subjectId - The ask or the action run.
 */
export async function getDecisionClock(orgId: string, subjectKind: 'ask' | 'proposal', subjectId: number): Promise<DecisionClock | null> {
  const [row] = await db
    .select()
    .from(decisionDeadlineSchema)
    .where(and(eq(decisionDeadlineSchema.orgId, orgId), eq(decisionDeadlineSchema.subjectKind, subjectKind), eq(decisionDeadlineSchema.subjectId, subjectId)))
    .limit(1);
  return row ?? null;
}

export class DefaultUndoError extends Error {
  constructor(message: string, public readonly status: 404 | 409) {
    super(message);
    this.name = 'DefaultUndoError';
  }
}

/**
 * Take back an answer that applied by default: the question is open again, in
 * front of people, and its default never applies a second time — a person
 * who undid it is the person who decides it. Only an answer the deadline
 * gave; a person's own answer is never unwritten here.
 * @param opts - Which ask, and who.
 * @param opts.orgId - The workspace.
 * @param opts.askId - The ask.
 * @param opts.by - The person undoing it.
 * @param opts.now - The clock.
 */
export async function undoAskDefault(opts: { orgId: string; askId: number; by: string; now?: Date }): Promise<Ask> {
  const now = opts.now ?? new Date();
  const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.id, opts.askId))).limit(1);
  if (!ask) {
    throw new DefaultUndoError(`No ask ${opts.askId}`, 404);
  }
  if (ask.decidedBy !== DEFAULT_DECIDER) {
    throw new DefaultUndoError(ask.status === 'open' ? `Ask ${opts.askId} is open — nothing to undo` : `Ask ${opts.askId} was answered by ${ask.decidedBy ?? 'someone'}, not by default; only a default can be undone here`, 409);
  }
  const [row] = await db
    .update(askSchema)
    .set({ status: 'open', decision: null, decisionNote: null, followUp: false, decidedBy: null, decidedAt: null, updatedAt: now })
    .where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.id, opts.askId), eq(askSchema.decidedBy, DEFAULT_DECIDER)))
    .returning();
  if (!row) {
    throw new DefaultUndoError(`Ask ${opts.askId} changed while it was being undone`, 409);
  }
  await db
    .update(decisionDeadlineSchema)
    .set({ status: 'held', undoneAt: now, undoneBy: opts.by, outcomeReason: 'a person took the default back, so it waits for their answer', nextAt: new Date(now.getTime() + RE_ESCALATE_MS), updatedAt: now })
    .where(and(eq(decisionDeadlineSchema.orgId, opts.orgId), eq(decisionDeadlineSchema.subjectKind, 'ask'), eq(decisionDeadlineSchema.subjectId, opts.askId)));
  return row;
}

/**
 * How many decisions in this workspace are past their deadline and still
 * waiting — a number the header can carry.
 * @param orgId - The workspace.
 */
export async function heldCount(orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(decisionDeadlineSchema)
    .where(and(eq(decisionDeadlineSchema.orgId, orgId), eq(decisionDeadlineSchema.status, 'held')));
  return Number(row?.n ?? 0);
}
