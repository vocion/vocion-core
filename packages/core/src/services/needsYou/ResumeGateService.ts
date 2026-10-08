import type { AskOption } from '@/models/Schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema, automationSchema, missionRunSchema, resumeGateSchema, workerRunSchema } from '@/models/Schema';

/**
 * ResumeGateService — a run with nothing to do but wait stops spending.
 *
 * The zero-person company kept paying for long runs whose every remaining
 * step waited on a person. So a long-running worker run, a mission run, or a
 * scheduled automation whose remaining work is all blocked on asks PARKS:
 *
 *   - ONE resume-gate ask goes on Needs you — "nothing I can do until …" —
 *     with Resume now and Stop. A second park of the same subject joins it.
 *   - The subject stops spending. A worker run is `paused` and gives up its
 *     lease (its heartbeat reply says `paused`; the reaper leaves it alone); a
 *     mission run is `paused` before its next task; an automation's schedule
 *     ticks are skipped and logged (`waiting_on_ask`).
 *   - Answering resumes it: the gate ask's Resume, or — on its own — the
 *     moment no ask it waits on is open any more. A worker run is queued
 *     again for any worker to claim with its cursor; a mission run continues
 *     from its next task; an automation fires once and its schedule runs on.
 *     Stop cancels the run, or pauses the automation as the person's act.
 *
 * WHAT is blocked is declared, never inferred from words: the run names the
 * asks (`POST /worker-runs/:id/park`, or the agent's `wait_for_answers`
 * tool), and each must be an open ask in the same workspace. Every read and
 * write is scoped by org. A resume that fails is written on the gate
 * (`last_error`) and retried by the needs-you sweep — nothing waits forever
 * because one write failed.
 */

export type ResumeGate = typeof resumeGateSchema.$inferSelect;
type Ask = typeof askSchema.$inferSelect;

/** What can park. */
export type GateSubject
  = | { kind: 'worker_run'; id: number }
    | { kind: 'mission_run'; id: number; automationSlug?: string | null }
    | { kind: 'automation'; slug: string };

/** The prefix of a gate ask's `sourceRef` — `resume-gate:<gate id>`. */
export const GATE_SOURCE_PREFIX = 'resume-gate:';

/** A mission run parked by a gate carries this pause reason: `waiting_on_asks:<gate id>`. */
export const MISSION_PAUSE_PREFIX = 'waiting_on_asks:';

/** At most this many asks per park. A run waiting on more than this is waiting on a report, not on answers. */
const MAX_WAITING_ON = 50;

export class ResumeGateError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION_FAILED',
    message: string,
    public readonly status: 404 | 409 | 400,
  ) {
    super(message);
    this.name = 'ResumeGateError';
  }
}

function subjectRef(subject: GateSubject): string {
  return subject.kind === 'automation' ? subject.slug : String(subject.id);
}

function subjectLabel(subject: GateSubject): string {
  return subject.kind === 'worker_run' ? `Worker run #${subject.id}` : subject.kind === 'mission_run' ? `Mission run #${subject.id}` : `The ${subject.slug} automation`;
}

/**
 * Where the long form of the subject lives — its run page or the automation.
 * @param subject - What parked.
 */
function subjectUrl(subject: GateSubject): string {
  return subject.kind === 'worker_run'
    ? `/dashboard/p/runs/worker-${subject.id}`
    : subject.kind === 'mission_run'
      ? `/dashboard/inbox/mission-${subject.id}`
      : `/dashboard/automation/${subject.slug}`;
}

/**
 * The gate's two answers. Neither is recommended: a gate is never answered by default.
 * @param subject - What parked.
 */
function gateOptions(subject: GateSubject): AskOption[] {
  return [
    { id: 'resume', label: 'Resume now', description: 'It picks up where it stopped, with whatever has been answered.' },
    subject.kind === 'automation'
      ? { id: 'stop', label: 'Pause the automation', description: 'Its schedule stays off until someone resumes it.' }
      : { id: 'stop', label: 'Stop it', description: 'The run is cancelled; nothing more is spent on it.' },
  ];
}

function clamp(text: string, n: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * The gate ask's words. The title is the parker's own line for what it waits
 * on — placed, never read — else the one question's title, else a count.
 * @param opts - The gate.
 * @param opts.subject - What parked.
 * @param opts.agentSlug - Who parked, when an agent did.
 * @param opts.reason - What it is waiting for, in its own words.
 * @param opts.waiting - The open asks it waits on.
 */
function gateWords(opts: { subject: GateSubject; agentSlug: string | null; reason: string | null; waiting: Ask[] }): { title: string; body: string; contextMd: string } {
  const who = opts.agentSlug ?? subjectLabel(opts.subject).toLowerCase();
  const until = opts.reason?.trim()
    ? clamp(opts.reason, 60)
    : opts.waiting.length === 1
      ? `you answer “${clamp(opts.waiting[0]!.title, 50)}”`
      : `${opts.waiting.length} questions are answered`;
  const spend = opts.subject.kind === 'automation' ? 'no model calls and no scheduled checks' : 'no model calls';
  const n = opts.waiting.length;
  return {
    title: `Nothing ${who} can do until ${until}`,
    body: `${subjectLabel(opts.subject)} stopped spending — ${spend} — until then. Answering ${n === 1 ? 'that question' : `those ${n} questions`} resumes it on its own; Resume now picks it up as things stand.`,
    contextMd: ['## Waiting on', '', ...opts.waiting.map(a => `- [#${a.id} ${a.title}](/dashboard/inbox/${a.id})`)].join('\n'),
  };
}

async function readAsks(orgId: string, ids: number[]): Promise<Ask[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, ids)));
}

/**
 * The ask ids a caller sent, as distinct positive integers. Refuses anything
 * else, an empty list, or more than {@link MAX_WAITING_ON}.
 * @param raw - Whatever arrived.
 */
export function normaliseWaitingOn(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ResumeGateError('VALIDATION_FAILED', 'waitingOn must name at least one ask id — the questions the run is blocked on', 400);
  }
  const ids = [...new Set(raw.map(v => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v)))];
  if (ids.some(v => typeof v !== 'number' || !Number.isInteger(v) || v <= 0)) {
    throw new ResumeGateError('VALIDATION_FAILED', 'waitingOn must be ask ids (positive integers)', 400);
  }
  if (ids.length > MAX_WAITING_ON) {
    throw new ResumeGateError('VALIDATION_FAILED', `waitingOn may name at most ${MAX_WAITING_ON} asks`, 400);
  }
  return ids as number[];
}

/**
 * The parked gate standing for a subject, or null.
 * @param orgId - The workspace.
 * @param subject - What parked.
 */
export async function parkedGateFor(orgId: string, subject: GateSubject): Promise<ResumeGate | null> {
  const [row] = await db
    .select()
    .from(resumeGateSchema)
    .where(and(eq(resumeGateSchema.orgId, orgId), eq(resumeGateSchema.subjectKind, subject.kind), eq(resumeGateSchema.subjectRef, subjectRef(subject)), eq(resumeGateSchema.status, 'parked')))
    .limit(1);
  return row ?? null;
}

/**
 * Check the subject exists in this workspace and can still park.
 * @param orgId - The workspace.
 * @param subject - What parks.
 */
async function assertParkable(orgId: string, subject: GateSubject): Promise<void> {
  if (subject.kind === 'worker_run') {
    const [run] = await db.select({ status: workerRunSchema.status }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, subject.id))).limit(1);
    if (!run) {
      throw new ResumeGateError('NOT_FOUND', `No worker run ${subject.id}`, 404);
    }
    if (run.status !== 'running' && run.status !== 'paused') {
      throw new ResumeGateError('CONFLICT', `Worker run ${subject.id} is ${run.status}; only a running run can park`, 409);
    }
    return;
  }
  if (subject.kind === 'mission_run') {
    const [run] = await db.select({ status: missionRunSchema.status }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, subject.id))).limit(1);
    if (!run) {
      throw new ResumeGateError('NOT_FOUND', `No mission run ${subject.id}`, 404);
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      throw new ResumeGateError('CONFLICT', `Mission run ${subject.id} is ${run.status}; there is nothing left to park`, 409);
    }
    return;
  }
  const [automation] = await db.select({ id: automationSchema.id }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, subject.slug))).limit(1);
  if (!automation) {
    throw new ResumeGateError('NOT_FOUND', `No automation "${subject.slug}"`, 404);
  }
}

/**
 * Stop the subject spending. Idempotent.
 * @param orgId - The workspace.
 * @param subject - What parked.
 * @param gateId - The gate holding it.
 * @param now - The clock.
 */
async function holdSubject(orgId: string, subject: GateSubject, gateId: number, now: Date): Promise<void> {
  if (subject.kind === 'worker_run') {
    // Paused, and holding no lease: nothing runs for it, the reaper leaves it
    // alone, and it is claimable again only once it is queued on resume.
    await db
      .update(workerRunSchema)
      .set({ status: 'paused', leaseExpiresAt: null, updatedAt: now })
      .where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, subject.id), inArray(workerRunSchema.status, ['running', 'paused'])));
    return;
  }
  if (subject.kind === 'mission_run') {
    // The loop reads this before its next task and stops there
    // (`missions/runtime.ts`); a task already running finishes its turn.
    await db
      .update(missionRunSchema)
      .set({ status: 'paused', pauseReason: `${MISSION_PAUSE_PREFIX}${gateId}`, pausedAt: now })
      .where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, subject.id), inArray(missionRunSchema.status, ['planning', 'running', 'paused'])));
  }
  // An automation is held by the gate row itself: its schedule ticks read it.
}

export type ParkResult = { gate: ResumeGate; gateAskId: number; created: boolean; waitingOn: number[] };

/**
 * Park a subject on the asks it is blocked on: file (or refresh) its one
 * gate ask and stop it spending.
 *
 * Refuses (409) when none of the named asks is still open — there is nothing
 * to wait for, and the right move is to read the answers and carry on.
 * @param opts - What parks, and on what.
 * @param opts.orgId - The workspace.
 * @param opts.subject - What parks.
 * @param opts.waitingOn - The asks it is blocked on.
 * @param opts.agentSlug - Who parked it, when an agent did.
 * @param opts.reason - What it is waiting for, in its own words.
 * @param opts.now - The clock.
 */
export async function parkOnAsks(opts: { orgId: string; subject: GateSubject; waitingOn: unknown; agentSlug?: string | null; reason?: string | null; now?: Date }): Promise<ParkResult> {
  const now = opts.now ?? new Date();
  const ids = normaliseWaitingOn(opts.waitingOn);
  const asks = await readAsks(opts.orgId, ids);
  const found = new Set(asks.map(a => a.id));
  const missing = ids.filter(id => !found.has(id));
  if (missing.length > 0) {
    // A wrong id and another workspace's id read the same: not here.
    throw new ResumeGateError('NOT_FOUND', `No ask ${missing.join(', ')} in this workspace`, 404);
  }
  const open = asks.filter(a => a.status === 'open');
  if (open.length === 0) {
    throw new ResumeGateError('CONFLICT', 'Nothing to wait for: every ask named is already answered — read the answers and carry on', 409);
  }
  await assertParkable(opts.orgId, opts.subject);
  const automationSlug = opts.subject.kind === 'automation' ? opts.subject.slug : opts.subject.kind === 'mission_run' ? (opts.subject.automationSlug ?? null) : null;
  const ref = subjectRef(opts.subject);
  const reason = opts.reason?.trim() ? opts.reason.trim().slice(0, 500) : null;

  let gate: ResumeGate | null = await parkedGateFor(opts.orgId, opts.subject);
  let created = false;
  if (gate) {
    const merged = [...new Set([...gate.waitingOn, ...open.map(a => a.id)])];
    const [updated] = await db.update(resumeGateSchema).set({ waitingOn: merged, reason: reason ?? gate.reason, updatedAt: now }).where(eq(resumeGateSchema.id, gate.id)).returning();
    gate = updated ?? gate;
  } else {
    const [inserted] = await db
      .insert(resumeGateSchema)
      .values({ orgId: opts.orgId, subjectKind: opts.subject.kind, subjectRef: ref, automationSlug, agentSlug: opts.agentSlug ?? null, waitingOn: open.map(a => a.id), reason, status: 'parked', parkedAt: now, createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      gate = inserted;
      created = true;
    } else {
      // Another park of the same subject won the race: join it.
      return parkOnAsks(opts);
    }
  }

  // ONE gate ask per park, keyed on the gate: re-parking refreshes it.
  const waitingNow = await readAsks(opts.orgId, gate!.waitingOn);
  const words = gateWords({ subject: opts.subject, agentSlug: gate!.agentSlug, reason: gate!.reason, waiting: waitingNow.filter(a => a.status === 'open') });
  const { upsertAsk } = await import('@/services/AskService');
  const { ask } = await upsertAsk({
    orgId: opts.orgId,
    createdBy: opts.agentSlug ? `agent:${opts.agentSlug}` : null,
    ask: {
      kind: 'gate',
      title: words.title,
      body: words.body,
      contextMd: words.contextMd,
      contextUrl: subjectUrl(opts.subject),
      sourceRef: `${GATE_SOURCE_PREFIX}${gate!.id}`,
      agentSlug: gate!.agentSlug,
      risk: 'low',
      options: gateOptions(opts.subject),
    },
  });
  if (gate!.gateAskId !== ask.id) {
    const [updated] = await db.update(resumeGateSchema).set({ gateAskId: ask.id, updatedAt: now }).where(eq(resumeGateSchema.id, gate!.id)).returning();
    gate = updated ?? gate;
  }
  await holdSubject(opts.orgId, opts.subject, gate!.id, now);
  return { gate: gate!, gateAskId: ask.id, created, waitingOn: gate!.waitingOn };
}

function subjectOf(gate: ResumeGate): GateSubject {
  if (gate.subjectKind === 'automation') {
    return { kind: 'automation', slug: gate.subjectRef };
  }
  return gate.subjectKind === 'worker_run' ? { kind: 'worker_run', id: Number(gate.subjectRef) } : { kind: 'mission_run', id: Number(gate.subjectRef), automationSlug: gate.automationSlug };
}

/**
 * Write a failure on the gate, where it is read, and leave it parked for the sweep to retry.
 * @param gate - The gate.
 * @param message - What went wrong.
 */
async function recordError(gate: ResumeGate, message: string): Promise<void> {
  await db.update(resumeGateSchema).set({ lastError: message.slice(0, 500), updatedAt: new Date() }).where(eq(resumeGateSchema.id, gate.id));
}

/**
 * Close the gate as `resumed` or `stopped`, once — the conditional write is
 * the claim, so two answers racing resolve it a single time.
 * @param gate - The gate.
 * @param status - How it ended.
 * @param by - Who ended it.
 * @param note - Why.
 */
async function closeGate(gate: ResumeGate, status: 'resumed' | 'stopped', by: string, note: string): Promise<boolean> {
  const rows = await db
    .update(resumeGateSchema)
    .set({ status, resolvedAt: new Date(), resolvedBy: by, resolutionNote: note.slice(0, 500), lastError: null, updatedAt: new Date() })
    .where(and(eq(resumeGateSchema.id, gate.id), eq(resumeGateSchema.status, 'parked')))
    .returning({ id: resumeGateSchema.id });
  return rows.length > 0;
}

/**
 * The gate ask leaves Needs you when the gate closed for another reason —
 * unless another parked gate still shares it.
 * @param gate - The gate that closed.
 * @param note - Why, for the ask's record.
 */
async function retireGateAsk(gate: ResumeGate, note: string): Promise<void> {
  if (!gate.gateAskId) {
    return;
  }
  const [stillShared] = await db.select({ id: resumeGateSchema.id }).from(resumeGateSchema).where(and(eq(resumeGateSchema.orgId, gate.orgId), eq(resumeGateSchema.gateAskId, gate.gateAskId), eq(resumeGateSchema.status, 'parked'))).limit(1);
  if (stillShared) {
    return;
  }
  const [ask] = await db.select({ status: askSchema.status }).from(askSchema).where(and(eq(askSchema.orgId, gate.orgId), eq(askSchema.id, gate.gateAskId))).limit(1);
  if (ask?.status === 'open') {
    const { supersedeAsk } = await import('@/services/AskService');
    await supersedeAsk(gate.orgId, gate.gateAskId, note);
  }
}

/**
 * Resume a parked subject. A worker run is queued again (any worker claims
 * it, with its cursor); a mission run continues from its next task on a
 * durable job; an automation fires once now and its schedule runs on.
 * @param gate - The gate.
 * @param by - Who resumed it — a person, or `answers`.
 * @param note - Why, for the record.
 */
export async function resumeGate(gate: ResumeGate, by: string, note: string): Promise<{ resumed: boolean; error?: string }> {
  const subject = subjectOf(gate);
  try {
    if (subject.kind === 'worker_run') {
      await db
        .update(workerRunSchema)
        .set({ status: 'queued', updatedAt: new Date() })
        .where(and(eq(workerRunSchema.orgId, gate.orgId), eq(workerRunSchema.id, subject.id), eq(workerRunSchema.status, 'paused')));
    } else if (subject.kind === 'mission_run') {
      const { startJob } = await import('@/libs/durable/jobs');
      const { JOB } = await import('@/services/background/catalog');
      await startJob(`resume-gate-${gate.id}`, { job: JOB.missionRunResume, input: { orgId: gate.orgId, runId: subject.id, gateId: gate.id } });
    }
  } catch (err) {
    const message = `could not resume: ${(err as Error).message}`;
    await recordError(gate, message);
    return { resumed: false, error: message };
  }
  if (!(await closeGate(gate, 'resumed', by, note))) {
    return { resumed: false };
  }
  if (subject.kind === 'automation') {
    // The answer is acted on now, not at the next tick a week away. A fire
    // that cannot start is not a failure of the resume — the schedule is free
    // again and the next tick runs it — so it is noted, not retried.
    try {
      const { startJob } = await import('@/libs/durable/jobs');
      const { JOB } = await import('@/services/background/catalog');
      await startJob(`resume-gate-${gate.id}-fire`, { job: JOB.automationFire, input: { orgId: gate.orgId, slug: subject.slug, invokedBy: `resume-gate:${gate.id}` } });
    } catch (err) {
      await db.update(resumeGateSchema).set({ resolutionNote: `${note} The immediate fire could not start (${(err as Error).message}); the next scheduled check runs it.`.slice(0, 500) }).where(eq(resumeGateSchema.id, gate.id));
    }
  }
  await retireGateAsk(gate, note);
  return { resumed: true };
}

/**
 * Stop a parked subject at a person's word: the run is cancelled, or the
 * automation paused in that person's name.
 * @param gate - The gate.
 * @param by - Who stopped it.
 * @param note - Their note, if any.
 */
export async function stopGate(gate: ResumeGate, by: string, note: string): Promise<{ stopped: boolean; error?: string }> {
  const subject = subjectOf(gate);
  try {
    if (subject.kind === 'worker_run') {
      const now = new Date();
      await db
        .update(workerRunSchema)
        .set({ status: 'cancelled', stopRequested: true, error: 'stopped while it waited on answers', completedAt: now, updatedAt: now })
        .where(and(eq(workerRunSchema.orgId, gate.orgId), eq(workerRunSchema.id, subject.id), eq(workerRunSchema.status, 'paused')));
    } else if (subject.kind === 'mission_run') {
      const { cancelMission } = await import('@/services/MissionService');
      await cancelMission(subject.id, gate.orgId, 'stopped while it waited on answers');
    } else if (by.startsWith('usr-')) {
      const { AutomationPauseStateError, pauseAutomation } = await import('@/services/AutomationService');
      await pauseAutomation(gate.orgId, subject.slug, { by: { id: by }, note: note || 'Stopped while it waited on answers.' }).catch((err) => {
        // Already paused by someone: the stop already holds.
        if (!(err instanceof AutomationPauseStateError)) {
          throw err;
        }
      });
    }
  } catch (err) {
    const message = `could not stop: ${(err as Error).message}`;
    await recordError(gate, message);
    return { stopped: false, error: message };
  }
  return { stopped: await closeGate(gate, 'stopped', by, note || 'Stopped by a person.') };
}

/**
 * An ask was decided or withdrawn. If it is a gate ask, its answer resumes or
 * stops the subject; if a parked gate was waiting on it and nothing it waits
 * on is open any more, the subject resumes on its own. Called by
 * `AskService` after every decision and withdrawal.
 * @param ask - The ask as written.
 */
export async function onAskSettled(ask: Ask): Promise<void> {
  if (ask.status === 'open') {
    return;
  }
  if (ask.sourceRef?.startsWith(GATE_SOURCE_PREFIX)) {
    if (ask.status === 'superseded') {
      // Withdrawn by a gate as it closed, or by the asker: nothing to do.
      return;
    }
    // Several runs waiting on the same thing ask a person ONE question (an
    // open ask of the same kind and title is the same ask), so one answer
    // moves every gate that shares it.
    const sharing = await db.select().from(resumeGateSchema).where(and(eq(resumeGateSchema.orgId, ask.orgId), eq(resumeGateSchema.gateAskId, ask.id), eq(resumeGateSchema.status, 'parked')));
    const by = ask.decidedBy ?? 'unknown';
    for (const gate of sharing) {
      if (ask.decision === 'stop' || ask.decision === 'reject') {
        await stopGate(gate, by, ask.decisionNote ?? '');
      } else {
        await resumeGate(gate, by, ask.decisionNote?.trim() ? `Resumed: ${ask.decisionNote.trim()}` : 'Resumed by a person.');
      }
    }
    return;
  }
  const waiting = await db
    .select()
    .from(resumeGateSchema)
    .where(and(eq(resumeGateSchema.orgId, ask.orgId), eq(resumeGateSchema.status, 'parked'), sql`${resumeGateSchema.waitingOn} @> ${JSON.stringify([ask.id])}::jsonb`));
  for (const gate of waiting) {
    await resumeIfAnswered(gate);
  }
}

/**
 * Resume a gate when no ask it waits on is open any more.
 * @param gate - The gate.
 */
async function resumeIfAnswered(gate: ResumeGate): Promise<boolean> {
  const asks = await readAsks(gate.orgId, gate.waitingOn);
  if (asks.some(a => a.status === 'open')) {
    return false;
  }
  const n = gate.waitingOn.length;
  const out = await resumeGate(gate, 'answers', n === 1 ? 'The question it waited on was answered.' : `All ${n} questions it waited on were answered.`);
  return out.resumed;
}

/**
 * The healing pass, run by the needs-you sweep: every parked gate whose
 * questions are all answered (a hook that was missed), whose gate ask was
 * answered while the gate stayed parked, or whose last resume failed, is
 * tried again.
 * @param opts - Scope.
 * @param opts.orgId - One workspace, or every one when omitted.
 */
export async function healParkedGates(opts: { orgId?: string } = {}): Promise<{ resumed: number; errors: number }> {
  const gates = await db
    .select()
    .from(resumeGateSchema)
    .where(and(opts.orgId ? eq(resumeGateSchema.orgId, opts.orgId) : undefined, eq(resumeGateSchema.status, 'parked')))
    .limit(500);
  let resumed = 0;
  let errors = 0;
  for (const gate of gates) {
    try {
      if (gate.gateAskId) {
        const [gateAsk] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, gate.orgId), eq(askSchema.id, gate.gateAskId))).limit(1);
        if (gateAsk && gateAsk.status !== 'open' && gateAsk.status !== 'superseded') {
          await onAskSettled(gateAsk);
          resumed += 1;
          continue;
        }
      }
      if (await resumeIfAnswered(gate)) {
        resumed += 1;
      }
    } catch (err) {
      errors += 1;
      await recordError(gate, `the sweep could not resume it: ${(err as Error).message}`).catch(() => {});
    }
  }
  return { resumed, errors };
}

/**
 * The parked gate holding this automation's schedule, or null. Read by every
 * schedule tick before it spends anything.
 * @param orgId - The workspace.
 * @param slug - The automation.
 */
export async function automationHold(orgId: string, slug: string): Promise<ResumeGate | null> {
  const [row] = await db
    .select()
    .from(resumeGateSchema)
    .where(and(eq(resumeGateSchema.orgId, orgId), eq(resumeGateSchema.status, 'parked'), eq(resumeGateSchema.automationSlug, slug)))
    .limit(1);
  return row ?? null;
}

/**
 * Run ids parked by a gate, per kind — so Needs you shows the one gate ask
 * rather than the gate ask AND a "run paused" row for the same thing.
 * @param orgId - The workspace.
 */
export async function parkedRunIds(orgId: string): Promise<{ worker: Set<number>; mission: Set<number> }> {
  const rows = await db
    .select({ kind: resumeGateSchema.subjectKind, ref: resumeGateSchema.subjectRef })
    .from(resumeGateSchema)
    .where(and(eq(resumeGateSchema.orgId, orgId), eq(resumeGateSchema.status, 'parked'), inArray(resumeGateSchema.subjectKind, ['worker_run', 'mission_run'])));
  const worker = new Set<number>();
  const mission = new Set<number>();
  for (const r of rows) {
    (r.kind === 'worker_run' ? worker : mission).add(Number(r.ref));
  }
  return { worker, mission };
}

/**
 * The durable job behind a mission run's resume: claim the run back from its
 * gate's pause — the WHERE is the claim, so a second start finds nothing —
 * and run its remaining tasks.
 * @param input - The job input.
 * @param input.orgId - The workspace.
 * @param input.runId - The mission run.
 * @param input.gateId - The gate that parked it.
 */
export async function resumeParkedMissionRun(input: { orgId: string; runId: number; gateId: number }): Promise<{ resumed: boolean; status?: string }> {
  const claimed = await db
    .update(missionRunSchema)
    .set({ status: 'running', pauseReason: null, pausedAt: null })
    .where(and(
      eq(missionRunSchema.orgId, input.orgId),
      eq(missionRunSchema.id, input.runId),
      eq(missionRunSchema.status, 'paused'),
      eq(missionRunSchema.pauseReason, `${MISSION_PAUSE_PREFIX}${input.gateId}`),
    ))
    .returning({ id: missionRunSchema.id });
  if (claimed.length === 0) {
    return { resumed: false };
  }
  const { executeMissionRun } = await import('@/services/missions/runtime');
  return { resumed: true, status: await executeMissionRun(input.runId, input.orgId) };
}

/**
 * Is this mission run parked on a gate? The runtime asks before each task.
 * @param orgId - The workspace.
 * @param runId - The mission run.
 */
export async function missionRunParked(orgId: string, runId: number): Promise<boolean> {
  const [run] = await db.select({ status: missionRunSchema.status, pauseReason: missionRunSchema.pauseReason }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, runId))).limit(1);
  return run?.status === 'paused' && (run.pauseReason ?? '').startsWith(MISSION_PAUSE_PREFIX);
}
