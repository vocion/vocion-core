import type { AgentCallView, AgentTaskView, RunCheck, RunContext, RunCriterion, RunGlance, RunHeader, RunLink, RunLogData, RunLogEvent, RunLogLevel, RunWhy } from '@/libs/worker/runLog';
import { and, asc, count, eq, gt, inArray, lt, max } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { eventLevel, glanceOf, stopReason } from '@/libs/worker/runLog';
import { missionRunSchema, toolCallSchema, workerRunEventSchema, workerRunSchema } from '@/models/Schema';

/**
 * THE RUN'S STEP LOG, KEPT IN VOCION (backlog 036).
 *
 * Write side: a worker's heartbeat, complete and fail carry the lines it
 * printed since the last one as `events`, and {@link ingestRunEvents} lands
 * them in `worker_run_event` — bounded, idempotent on (run, seq), refused
 * for a run that has stopped unless it is the run's final batch.
 *
 * Read side: {@link readRunLog} returns what the run page draws — the run's
 * header, its lines (or, for an agent run, its plan and tool calls) after a
 * cursor, so the page polls for what is new rather than the whole list.
 *
 * Only the small step lines live here. A transcript or a full check log is
 * the worker's to store; it arrives as a link on `worker_run.result`
 * (`transcriptArtifactId`, `promptArtifactId`, `logLinks`) and the page links
 * it. Vocion never proxies those bytes.
 *
 * No static import of `libs/Logger` or of `WorkerRunService`: this module sits
 * in the durable executor's import chain through the reaper, and the service
 * imports it.
 */

/** At most this many lines in one heartbeat; the rest wait for the next. */
export const EVENTS_PER_REQUEST = 200;
/** At most this many lines per run; later ones are acknowledged and dropped. */
export const EVENTS_PER_RUN = 5000;
export const MESSAGE_CHARS = 2000;
export const FIELDS_BYTES = 8192;
/** Lines older than this are deleted by the reaper schedule; the run row stays. */
export const EVENT_RETENTION_DAYS = 30;

const LEVELS = new Set<RunLogLevel>(['info', 'warn', 'error']);

type IncomingEvent = {
  seq: number;
  ts: Date;
  phase: string;
  step: string | null;
  level: RunLogLevel;
  message: string | null;
  fields: Record<string, unknown>;
};

const utf8 = new TextEncoder();
function bytes(v: unknown): number {
  return utf8.encode(JSON.stringify(v)).length;
}

/**
 * A worker's `fields`, held to {@link FIELDS_BYTES}: long strings are cut
 * first (keeping the end of anything that is a tail, the start of the rest),
 * then the largest keys go until it fits, and `_truncated` says so.
 * @param raw - Whatever the worker sent.
 */
export function boundFields(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  let out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (bytes(out) <= FIELDS_BYTES) {
    return out;
  }
  out = Object.fromEntries(Object.entries(out).map(([k, v]) => {
    if (typeof v !== 'string' || v.length <= 1500) {
      return [k, v];
    }
    return [k, /tail|stderr|output|log/i.test(k) ? `…${v.slice(-1500)}` : `${v.slice(0, 1500)}…`];
  }));
  out._truncated = true;
  const keys = Object.keys(out).filter(k => k !== '_truncated').sort((a, b) => bytes(out[b]) - bytes(out[a]));
  while (bytes(out) > FIELDS_BYTES && keys.length > 0) {
    delete out[keys.shift()!];
  }
  return out;
}

/**
 * One event as the worker sent it, or null when it cannot be stored (no
 * positive integer seq, no phase).
 * @param raw - One element of `events`.
 */
export function normalizeEvent(raw: unknown): IncomingEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const e = raw as Record<string, unknown>;
  const seq = typeof e.seq === 'number' ? e.seq : Number.NaN;
  const phase = typeof e.phase === 'string' ? e.phase.trim().slice(0, 80) : '';
  if (!Number.isSafeInteger(seq) || seq < 1 || !phase) {
    return null;
  }
  const at = typeof e.ts === 'string' ? new Date(e.ts) : new Date(Number.NaN);
  const fields = boundFields(e.fields);
  const given = typeof e.level === 'string' && LEVELS.has(e.level as RunLogLevel) ? e.level as RunLogLevel : null;
  return {
    seq,
    ts: Number.isNaN(at.getTime()) ? new Date() : at,
    phase,
    step: typeof e.step === 'string' && e.step.trim() ? e.step.trim().slice(0, 40) : null,
    // Stored resolved, so a query for a run's errors reads a column.
    level: eventLevel({ phase, level: given, fields }),
    message: typeof e.message === 'string' && e.message.trim() ? e.message.slice(0, MESSAGE_CHARS) : null,
    fields,
  };
}

export type IngestResult
  = | { ok: true; accepted: number; stored: number; dropped: number }
    | { ok: false; reason: 'not_found' | 'not_running' };

/**
 * Land a worker's lines on its run.
 *
 * - Scoped by org: a run in another org is `not_found`.
 * - A run that is no longer running or paused takes lines only when they
 *   are its `final` batch (complete / fail), so a stray late heartbeat
 *   cannot write to a finished run.
 * - At most {@link EVENTS_PER_REQUEST} per call (lowest seqs first) and
 *   {@link EVENTS_PER_RUN} per run; a seq already stored is ignored.
 *
 * `accepted` is the highest seq Vocion has dealt with — stored, already held,
 * or dropped at the run cap — so a worker drops everything up to it and
 * never resends a line forever.
 * @param opts - The batch.
 * @param opts.orgId - Tenant.
 * @param opts.runId - The worker run.
 * @param opts.events - The `events` array as sent.
 * @param opts.final - The run's last word: accepted whatever its status.
 */
export async function ingestRunEvents(opts: { orgId: string; runId: number; events: readonly unknown[]; final?: boolean }): Promise<IngestResult> {
  const [run] = await db.select({ id: workerRunSchema.id, status: workerRunSchema.status })
    .from(workerRunSchema)
    .where(and(eq(workerRunSchema.orgId, opts.orgId), eq(workerRunSchema.id, opts.runId)))
    .limit(1);
  if (!run) {
    return { ok: false, reason: 'not_found' };
  }
  if (!opts.final && run.status !== 'running' && run.status !== 'paused') {
    return { ok: false, reason: 'not_running' };
  }
  const bySeq = new Map<number, IncomingEvent>();
  for (const raw of opts.events) {
    const e = normalizeEvent(raw);
    if (e && !bySeq.has(e.seq)) {
      bySeq.set(e.seq, e);
    }
  }
  const batch = [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(0, EVENTS_PER_REQUEST);
  const [held] = await db.select({ n: count(), top: max(workerRunEventSchema.seq) })
    .from(workerRunEventSchema)
    .where(eq(workerRunEventSchema.runId, run.id));
  const heldTop = held?.top ?? 0;
  if (batch.length === 0) {
    return { ok: true, accepted: heldTop, stored: 0, dropped: 0 };
  }
  const existing = new Set((await db.select({ seq: workerRunEventSchema.seq })
    .from(workerRunEventSchema)
    .where(and(eq(workerRunEventSchema.runId, run.id), inArray(workerRunEventSchema.seq, batch.map(e => e.seq))))).map(r => r.seq));
  const fresh = batch.filter(e => !existing.has(e.seq));
  const room = Math.max(0, EVENTS_PER_RUN - (held?.n ?? 0));
  const keep = fresh.slice(0, room);
  const stored = keep.length === 0
    ? 0
    : (await db.insert(workerRunEventSchema)
        .values(keep.map(e => ({ orgId: opts.orgId, runId: run.id, ...e })))
        .onConflictDoNothing({ target: [workerRunEventSchema.runId, workerRunEventSchema.seq] })
        .returning({ id: workerRunEventSchema.id })).length;
  const dropped = fresh.length - keep.length;
  const accepted = Math.max(heldTop, ...keep.map(e => e.seq), ...(dropped > 0 ? batch.map(e => e.seq) : []), ...batch.filter(e => existing.has(e.seq)).map(e => e.seq));
  return { ok: true, accepted, stored, dropped };
}

/**
 * Delete step lines older than {@link EVENT_RETENTION_DAYS}, a bounded batch
 * at a time so one sweep never holds a long lock. The reaper calls it every
 * few minutes; a backlog drains over a few sweeps.
 * @param now - The clock.
 * @param batch - Rows per sweep.
 * @returns How many rows went.
 */
export async function pruneRunEvents(now: Date = new Date(), batch = 5000): Promise<number> {
  const cutoff = new Date(now.getTime() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = db.select({ id: workerRunEventSchema.id }).from(workerRunEventSchema).where(lt(workerRunEventSchema.createdAt, cutoff)).limit(batch);
  const rows = await db.delete(workerRunEventSchema).where(inArray(workerRunEventSchema.id, old)).returning({ id: workerRunEventSchema.id });
  return rows.length;
}

/* ------------------------------------------------------------------ */
/* The block a person pastes into Claude Code                           */
/* ------------------------------------------------------------------ */

type WorkerRunRow = typeof workerRunSchema.$inferSelect;
type MissionRunRow = typeof missionRunSchema.$inferSelect;

function progressLog(progress: Record<string, unknown>): string[] {
  return Array.isArray(progress.log) ? (progress.log as unknown[]).map(String) : typeof progress.log === 'string' ? progress.log.split('\n') : [];
}

/**
 * FAIL CLEARLY, THEN ATTACH (Chris, 2026-09-28: "fail clearly so that we can
 * attach from here to fix the gap in Vocion SF and re run"). A stopped
 * engineering run carries one block a person pastes into Claude Code: the
 * run, where it stopped, why, the links and the last lines, and what to do
 * next. Null while the run is healthy. The run page and the preview both
 * print this one.
 * @param run - The run row.
 * @param lastLines - Its last lines, newest last.
 */
export async function workerRunAttach(run: WorkerRunRow, lastLines?: string[]): Promise<string | null> {
  if (!['failed', 'lost', 'cancelled'].includes(run.status)) {
    return null;
  }
  const progress = (run.progress ?? {}) as Record<string, unknown>;
  const input = (run.input ?? {}) as { task?: { task_id?: string; repo?: string } };
  const result = (run.result ?? {}) as { pr_url?: string };
  const stoppedAt = typeof progress.phase === 'string' ? progress.phase : null;
  const lines = lastLines ?? progressLog(progress);
  const { appBaseUrl } = await import('@/libs/links');
  return [
    `Vocion software factory run #${run.id} ${run.status}${input.task?.task_id ? ` (${input.task.task_id})` : ''}.`,
    stoppedAt ? `Stopped at: ${stoppedAt}` : null,
    run.error ? `Why: ${stopReason(run.error)}` : null,
    `Run: ${appBaseUrl()}/dashboard/p/runs/${run.id}`,
    result.pr_url ? `Pull request: ${result.pr_url}` : null,
    input.task?.repo ? `Repo: ${input.task.repo}` : null,
    lines.length > 0 ? `Last lines:\n${lines.slice(-15).join('\n')}` : null,
    'Find why the factory stopped here, fix the gap in Vocion (or the worker), ship it, then press Build again on the feature.',
  ].filter(Boolean).join('\n');
}

/**
 * The same block for an agent run that failed.
 * @param run - The mission run row.
 */
export async function missionRunAttach(run: MissionRunRow): Promise<string | null> {
  if (run.status !== 'failed') {
    return null;
  }
  const firstError = missionRunError(run);
  const { appBaseUrl } = await import('@/libs/links');
  return `Vocion agent run #${run.id} failed (${run.title}).\n${firstError ? `Why: ${stopReason(firstError)}\n` : ''}Run: ${appBaseUrl()}/dashboard/missions/runs/${run.id}\nFind why it stopped, fix the gap in Vocion, ship it, then run it again.`;
}

/**
 * The run's error, else the first task's.
 * @param run - The mission run row.
 */
export function missionRunError(run: MissionRunRow): string | null {
  const tasks = run.plan?.tasks ?? [];
  return run.error ?? tasks.map(t => (t.error ? String(t.error) : '')).find(Boolean) ?? null;
}

/* ------------------------------------------------------------------ */
/* Read                                                                 */
/* ------------------------------------------------------------------ */

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function str(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
}

function httpsOnly(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\//.test(v) ? v : null;
}

function readChecks(result: Record<string, unknown>): RunCheck[] {
  const raw = Array.isArray(result.checks) ? result.checks as unknown[] : [];
  return raw.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').map(c => ({
    name: str(c, 'name') ?? str(c, 'check') ?? 'check',
    status: typeof c.passed === 'boolean' ? (c.passed ? 'passed' : 'failed') : str(c, 'status') ?? 'unknown',
    tail: typeof c.tail === 'string' ? c.tail : null,
    durationS: typeof c.duration_s === 'number' ? c.duration_s : null,
  }));
}

async function workerHeader(run: WorkerRunRow, events: RunLogEvent[]): Promise<RunHeader> {
  const progress = (run.progress ?? {}) as Record<string, unknown>;
  const result = (run.result ?? {}) as Record<string, unknown>;
  const input = (run.input ?? {}) as { task?: { task_id?: string; objective?: string; title?: string } };
  const rawLinks = (result.logLinks && typeof result.logLinks === 'object' ? result.logLinks : {}) as Record<string, unknown>;
  const rawChecks = (rawLinks.checks && typeof rawLinks.checks === 'object' ? rawLinks.checks : {}) as Record<string, unknown>;
  const links: RunLink[] = [];
  const transcript = str(result, 'transcriptArtifactId');
  const prompt = str(result, 'promptArtifactId');
  if (transcript) {
    links.push({ label: 'Transcript', href: `/dashboard/artifacts/${encodeURIComponent(transcript)}`, external: false });
  }
  if (prompt) {
    links.push({ label: 'Prompt', href: `/dashboard/artifacts/${encodeURIComponent(prompt)}`, external: false });
  }
  // The Claude Code block's "last lines": the run's own last lines when it
  // sent them, else the progress tail it kept.
  const lastLines = events.length > 0 ? events.slice(-15).map(e => [e.phase, e.message].filter(Boolean).join(' ')) : undefined;
  const context = await runContext(run).catch(() => null);
  return {
    kind: 'worker',
    ref: String(run.id),
    id: run.id,
    // The feature's name, never the worker's handle for the task (`taskId`).
    title: context?.feature?.title ?? input.task?.title ?? `Engineering run ${run.id}`,
    objective: input.task?.objective ?? null,
    taskId: input.task?.task_id ?? null,
    seat: 'Engineer',
    status: run.status,
    attempt: run.attempt,
    startedAt: iso(run.claimedAt ?? run.createdAt),
    endedAt: iso(run.completedAt),
    cents: run.cents,
    model: run.model,
    target: run.workerTarget ?? null,
    prUrl: str(result, 'pr_url') ?? str(progress, 'prUrl'),
    error: run.error,
    summary: run.summary,
    links,
    logLinks: {
      stream: httpsOnly(rawLinks.stream),
      stderr: httpsOnly(rawLinks.stderr),
      checks: Object.fromEntries(Object.entries(rawChecks).map(([k, v]) => [k, httpsOnly(v)]).filter((kv): kv is [string, string] => kv[1] !== null)),
    },
    attach: await workerRunAttach(run, lastLines),
    progress: { phase: str(progress, 'phase'), note: str(progress, 'note') ?? str(progress, 'step'), log: progressLog(progress) },
    checks: readChecks(result),
    failures: (Array.isArray(run.failures) ? run.failures : []).map(f => ({ scope: f.scope ?? 'run', message: f.message ?? '' })),
    recovery: result.recovery && typeof result.recovery === 'object' ? str(result.recovery as Record<string, unknown>, 'line') : null,
    context,
  };
}

/**
 * Where an engineering run belongs, from its own input and the records it
 * names: the task's request (the feature), the task's plan, which attempt
 * this is (the feature's own recovery count), the other runs of the same
 * feature, the acceptance it carries with each criterion's verdict, the
 * branch it works on, and why this attempt was started.
 * @param run - The run.
 */
export async function runContext(run: WorkerRunRow): Promise<RunContext | null> {
  const input = (run.input ?? {}) as { task?: Record<string, unknown>; record?: { id?: unknown; type?: unknown } };
  const task = input.task ?? {};
  const requestId = Number(task.request_id ?? task.requestId);
  const taskId = Number(input.record?.id);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return null;
  }
  const { businessObjectSchema } = await import('@/models/Schema');
  const { recordLinksForOrg } = await import('@/services/objects/recordHref');
  const { recordCodeFrom, recordLinker } = await import('@/libs/workspace/recordHref');
  const { attemptOfRun, readRecovery } = await import('@/services/factory/recovery');
  const links = await recordLinksForOrg(run.orgId);
  const link = recordLinker(links);
  const ids = [requestId, ...(Number.isSafeInteger(taskId) && taskId > 0 ? [taskId] : [])];
  const rows = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title, meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, run.orgId), inArray(businessObjectSchema.id, ids)));
  const request = rows.find(r => r.id === requestId) ?? null;
  const taskRow = rows.find(r => r.id === taskId) ?? null;
  const taskMeta = (taskRow?.meta ?? {}) as Record<string, unknown>;
  const featureHref = link({ objectType: 'request', id: requestId });
  const planId = Number(taskMeta.planId ?? (task.plan as Record<string, unknown> | undefined)?.plan_id);
  let plan: RunContext['plan'] = null;
  if (Number.isSafeInteger(planId) && planId > 0) {
    const [p] = await db.select({ id: businessObjectSchema.id, title: businessObjectSchema.title }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, run.orgId), eq(businessObjectSchema.id, planId))).limit(1);
    plan = p ? { id: p.id, code: recordCodeFrom(links, { objectType: 'architecture_plan', id: p.id }), title: p.title, href: link({ objectType: 'architecture_plan', id: p.id }) } : null;
  }
  const { sql } = await import('drizzle-orm');
  const siblings = await db
    .select({ id: workerRunSchema.id, status: workerRunSchema.status })
    .from(workerRunSchema)
    .where(and(eq(workerRunSchema.orgId, run.orgId), sql`${workerRunSchema.input}->'task'->>'request_id' = ${String(requestId)}`))
    .orderBy(asc(workerRunSchema.id))
    .limit(50);
  const recovery = readRecovery((request?.meta ?? null) as Record<string, unknown> | null);
  const criteria = acceptanceOf(task.acceptance_contract, taskMeta.verdict);
  // The attempt before this one: the task this one superseded.
  const previousId = Number(taskMeta.previousTaskId ?? taskMeta.autoRetryOf);
  const [previous] = Number.isSafeInteger(previousId) && previousId > 0
    ? await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(and(eq(businessObjectSchema.orgId, run.orgId), eq(businessObjectSchema.id, previousId))).limit(1)
    : [];
  const entry = recovery.attempts.find(a => a.runId === run.id) ?? null;
  const { recordOrigin } = await import('@/services/objects/related');
  const origin = request ? await recordOrigin(run.orgId, { id: request.id, meta: (request.meta ?? {}) as Record<string, unknown> }).catch(() => null) : null;
  return {
    origin,
    feature: { id: requestId, code: recordCodeFrom(links, { objectType: 'request', id: requestId }), title: request?.title ?? recordCodeFrom(links, { objectType: 'request', id: requestId }), href: featureHref },
    plan,
    // The task's type as the run names it, never written here.
    task: taskRow && typeof input.record?.type === 'string' ? { id: taskRow.id, href: link({ objectType: input.record.type, id: taskRow.id }) } : null,
    attempt: attemptOfRun(recovery, run.id),
    others: siblings.filter(r => r.id !== run.id).map(r => ({ runId: r.id, status: r.status, href: `/dashboard/p/runs/${r.id}` })),
    acceptance: criteria.length > 0 ? { count: criteria.length, href: `${featureHref}#report-acceptance`, criteria } : null,
    branch: branchOf(run, taskMeta, typeof task.repo === 'string' ? task.repo : null),
    why: whyOfAttempt({
      previous: (previous?.meta ?? null) as Record<string, unknown> | null,
      note: typeof taskMeta.attemptNote === 'string' ? taskMeta.attemptNote : null,
      byPerson: entry === null,
      recoveryLine: entry?.line ?? null,
    }),
  };
}

/**
 * The acceptance a run carries, each criterion with its verdict when QA has
 * judged the task: matched by the criterion's own text, else by position.
 * @param contract - The contract's `acceptance_contract`.
 * @param verdict - The task's `verdict`, when it has one.
 */
export function acceptanceOf(contract: unknown, verdict: unknown): RunCriterion[] {
  const texts = (Array.isArray(contract) ? contract : []).map((c) => {
    if (typeof c === 'string') {
      return c.trim();
    }
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
    return String(o.statement ?? o.criterion ?? o.text ?? '').trim();
  }).filter(Boolean);
  const judged = Array.isArray((verdict as { criteria?: unknown } | null)?.criteria)
    ? ((verdict as { criteria: Array<{ criterion?: unknown; status?: unknown }> }).criteria)
    : null;
  return texts.map((text, i) => {
    if (!judged) {
      return { text, state: null as RunCriterion['state'] };
    }
    const hit = judged.find(j => typeof j.criterion === 'string' && j.criterion.trim() === text) ?? judged[i];
    const state: RunCriterion['state'] = hit ? (hit.status === 'proven' ? 'proven' : 'open') : null;
    return { text, state };
  });
}

/**
 * The branch a run works on: what it reported, what it kept, what its task
 * names — linked to the repository's tree when the repository is on GitHub.
 * @param run - The run.
 * @param taskMeta - Its task's metadata.
 * @param repo - The contract's repository URL.
 */
function branchOf(run: WorkerRunRow, taskMeta: Record<string, unknown>, repo: string | null): RunContext['branch'] {
  const result = (run.result ?? {}) as Record<string, unknown>;
  const progress = (run.progress ?? {}) as Record<string, unknown>;
  const name = str(result, 'branch') ?? str(progress, 'keptBranch') ?? str(progress, 'branch') ?? str(taskMeta, 'branch');
  if (!name) {
    return null;
  }
  const web = repo && /^https:\/\/github\.com\//.test(repo) ? repo.replace(/\.git$/, '') : null;
  return { name, href: web ? `${web}/tree/${name.split('/').map(encodeURIComponent).join('/')}` : null };
}

/**
 * Why an attempt was started, in one line, from what the records say — the
 * last attempt's CI failure or its send-back, whichever came last; else what
 * was asked of this attempt; else the factory's own reason. Null on a first
 * attempt: nothing came before it.
 * @param o - What the records hold.
 * @param o.previous - The metadata of the task this attempt superseded.
 * @param o.note - What was asked of this attempt (`attemptNote`).
 * @param o.byPerson - A person started it (the recovery did not).
 * @param o.recoveryLine - The factory's line for the attempt, when it started it.
 */
export function whyOfAttempt(o: { previous: Record<string, unknown> | null; note: string | null; byPerson: boolean; recoveryLine: string | null }): RunWhy | null {
  const prev = o.previous ?? {};
  const prUrl = str(prev, 'prUrl');
  const ci = (prev.ciFailure && typeof prev.ciFailure === 'object' ? prev.ciFailure : null) as Record<string, unknown> | null;
  const verdict = (prev.verdict && typeof prev.verdict === 'object' ? prev.verdict : null) as Record<string, unknown> | null;
  const sentBack = verdict && verdict.value !== 'approve' ? verdict : null;
  const at = (v: Record<string, unknown> | null) => (v && typeof v.at === 'string' ? Date.parse(v.at) || 0 : 0);
  const firstLine = (t: unknown) => (typeof t === 'string' ? t.split('\n').map(l => l.trim()).find(Boolean) ?? null : null);
  const fromCi: RunWhy | null = ci
    ? { kind: 'ci', line: `CI failed on the pull request${str(ci, 'failing') ? `: ${str(ci, 'failing')}` : ''}`, detail: firstLine(ci.detail), href: prUrl }
    : null;
  const fromReview: RunWhy | null = sentBack
    ? { kind: 'review', line: `${(sentBack as { heldBy?: string }).heldBy === 'person' ? 'The person who merges held it' : 'QA sent it back'}${typeof sentBack.proven === 'number' && typeof sentBack.total === 'number' ? ` (${sentBack.proven} of ${sentBack.total} proven)` : ''}`, detail: firstLine(String(sentBack.note ?? '').replace(/^A person held the merge: /, '')), href: prUrl }
    : null;
  const fromNote: RunWhy | null = o.note ? { kind: 'note', line: firstLine(o.note) ?? o.note, detail: null, href: null } : null;
  if (o.byPerson && fromNote) {
    return fromNote;
  }
  if (fromCi && fromReview) {
    return at(ci) >= at(sentBack) ? fromCi : fromReview;
  }
  return fromCi ?? fromReview ?? fromNote ?? (o.recoveryLine ? { kind: 'recovery', line: stopReason(o.recoveryLine, 240), detail: null, href: null } : null);
}

/**
 * A tool call's input as one short line: the argument that says what it was
 * about (a query, a path, a slug), else the JSON, cut.
 * @param input - The stored input.
 */
export function shortInput(input: Record<string, unknown> | null | undefined): string {
  if (!input || typeof input !== 'object') {
    return '';
  }
  for (const k of ['query', 'command', 'path', 'file_path', 'url', 'slug', 'title', 'name', 'id', 'q']) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) {
      const one = v.replace(/\s+/g, ' ').trim();
      return one.length > 120 ? `${one.slice(0, 120)}…` : one;
    }
  }
  const json = JSON.stringify(input);
  return json === '{}' ? '' : json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

async function agentHeader(run: MissionRunRow): Promise<RunHeader> {
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts : [];
  return {
    kind: 'agent',
    ref: `agent-${run.id}`,
    id: run.id,
    title: run.title,
    objective: run.brief ? (run.brief.length > 400 ? `${run.brief.slice(0, 400)}…` : run.brief) : null,
    status: run.status,
    attempt: null,
    startedAt: iso(run.createdAt),
    endedAt: iso(run.completedAt),
    cents: null,
    model: null,
    prUrl: null,
    error: missionRunError(run),
    summary: null,
    links: artifacts.filter(a => typeof a.url === 'string' && a.url).slice(0, 12).map(a => ({ label: a.title ?? a.kind ?? 'Artifact', href: a.url, external: /^https?:\/\//.test(a.url) })),
    logLinks: { stream: null, stderr: null, checks: {} },
    attach: await missionRunAttach(run),
    progress: { phase: null, note: null, log: [] },
    checks: [],
    failures: [],
  };
}

/**
 * What the run page draws for one run, or null when the org holds no such
 * run. `ref` is the page's path id: `123` is an engineering run,
 * `agent-45` an agent run. `after` is the cursor the page already holds —
 * lines (or tool calls) after it come back, the header and plan always do.
 * @param orgId - Tenant.
 * @param ref - The run page's id.
 * @param after - The last seq (engineering) or tool call id (agent) held.
 */
export async function readRunLog(orgId: string, ref: string, after = 0): Promise<RunLogData | null> {
  const agent = /^agent-(\d+)$/.exec(ref);
  const id = Number.parseInt(agent ? agent[1]! : ref, 10);
  if (!Number.isSafeInteger(id) || id <= 0 || (!agent && !/^\d+$/.test(ref))) {
    return null;
  }
  if (agent) {
    const [run] = await db.select().from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, id))).limit(1);
    if (!run) {
      return null;
    }
    const rows = await db
      .select({ id: toolCallSchema.id, tool: toolCallSchema.tool, agent: toolCallSchema.agentSlug, lead: toolCallSchema.leadAgentSlug, input: toolCallSchema.input, error: toolCallSchema.error, ms: toolCallSchema.durationMs, at: toolCallSchema.createdAt })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), eq(toolCallSchema.missionRunId, id), gt(toolCallSchema.id, after)))
      .orderBy(asc(toolCallSchema.id))
      .limit(2000);
    const calls: AgentCallView[] = rows.map(r => ({ id: r.id, tool: r.tool, agent: r.agent, lead: r.lead, input: shortInput(r.input), ok: !r.error, error: r.error ? r.error.slice(0, 2000) : null, ms: r.ms, at: r.at.toISOString() }));
    const tasks: AgentTaskView[] = (run.plan?.tasks ?? []).map(t => ({
      id: String(t.id),
      title: t.title ?? 'Task',
      status: t.status ?? 'pending',
      owner: t.ownerAgentSlug ?? null,
      output: typeof t.output === 'string' && t.output.trim() ? t.output.slice(0, 8000) : null,
      error: t.error ? String(t.error).slice(0, 2000) : null,
      startedAt: t.startedAt ?? null,
      endedAt: t.endedAt ?? null,
    }));
    return { header: await agentHeader(run), events: [], tasks, calls, cursor: Math.max(after, ...calls.map(c => c.id)) };
  }
  const [run] = await db.select().from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), eq(workerRunSchema.id, id))).limit(1);
  if (!run) {
    return null;
  }
  const rows = await db.select()
    .from(workerRunEventSchema)
    .where(and(eq(workerRunEventSchema.orgId, orgId), eq(workerRunEventSchema.runId, id), gt(workerRunEventSchema.seq, after)))
    .orderBy(asc(workerRunEventSchema.seq))
    .limit(EVENTS_PER_RUN);
  const events: RunLogEvent[] = rows.map(r => ({ seq: r.seq, ts: r.ts.toISOString(), phase: r.phase, step: r.step, level: LEVELS.has(r.level as RunLogLevel) ? r.level as RunLogLevel : null, message: r.message, fields: r.fields ?? {} }));
  return { header: await workerHeader(run, events), events, tasks: [], calls: [], cursor: Math.max(after, ...events.map(e => e.seq)) };
}

/**
 * A run as the preview pane shows it: the header, the steps without their
 * logs, and the Now line (`RunGlance`). The pane re-reads it whole while the
 * run is live, so it stays small whatever the run printed.
 * @param orgId - Tenant.
 * @param ref - The run page's id (`123`, or `agent-45`).
 */
export async function readRunGlance(orgId: string, ref: string): Promise<RunGlance | null> {
  const data = await readRunLog(orgId, ref);
  return data ? glanceOf(data) : null;
}
