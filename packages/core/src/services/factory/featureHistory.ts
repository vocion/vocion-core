import type { FeatureReportInput, HistoryCost, HistoryRow, ReportActivity, ReportAttempt, ReportImplementation, ReportObject, ReportReleaseSummary, Tone } from './featureReport';
import { nounCode } from '@/libs/codes';
import { readDelivery } from '@/libs/factory/delivery';
import { readRequestLive } from '@/libs/factory/liveCheck';
import { prNumberLabel, runTitle } from '@/libs/factory/runTitle';
import { readRecovery } from './recovery';

/**
 * THE FEATURE'S TIMELINE, ASSEMBLED (Chris, 2026-10-02, FE-370).
 *
 * The page had two sections called "Activity" with different content, a
 * "View all work" that opened "Connected work", and the same runs listed in
 * three places. This is the one list that replaces the Activity card, the
 * Implementation rows, the bottom event log and the "Connected work" sheet:
 *
 *   - the conversations it was discussed in, where it started last;
 *   - the plan, its approval;
 *   - each attempt as one group — "Attempt 3 of 3 · passed · $0.75" — with
 *     its build and QA's reviews of it under it;
 *   - the merge, the deploy, the release, the live check;
 *   - the factory's own notes, when no typed row already says the same thing.
 *
 * NEWEST FIRST, strictly — the order the Activity list already kept (Chris,
 * 2026-09-30, #269: "the most recent thing doesn't have the work that we
 * approved"), and the order that lets the page's few rows say where the work
 * has got to. The side panel draws the same rows, all of them.
 *
 * Every run is titled by `runTitle`, from typed facts: the attempt, its
 * checks and pull request, the automation's own words for what it did, and
 * what the record it wrote says (QA's verdict on the attempt's task, the live
 * check on the request, the plan it filed). Pure: no reads, no clock.
 */

/** Two typed rows this close in time are the same moment; a note between them says nothing new. */
const NOTE_NEAR_MS = 10_000;
/** How long after a run's end the record it wrote may be stamped (a recording pass runs after it). */
const WROTE_AFTER_MS = 5 * 60_000;

type Verdict = { value: string; at: Date | null; proven: number | null; total: number | null; note: string | null; open: string | null };

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const time = (d: Date | string | null | undefined): number | null => (d ? new Date(d).getTime() : null);

/**
 * A phrase cut at a word, at most `max` characters.
 * @param text - The phrase.
 * @param max - The most characters.
 */
function clip(text: string, max = 72): string {
  const flat = text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (flat.length <= max) {
    return flat;
  }
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).trimEnd()}…`;
}

/**
 * QA's verdict as the attempt's task records it, or null.
 * @param task - The task.
 */
function verdictOf(task: ReportObject | undefined): Verdict | null {
  const v = task?.meta.verdict;
  if (!v || typeof v !== 'object') {
    return null;
  }
  const bag = v as Record<string, unknown>;
  if (typeof bag.value !== 'string') {
    return null;
  }
  const criteria = Array.isArray(bag.criteria) ? bag.criteria as Array<Record<string, unknown>> : [];
  const open = criteria.find(c => c && c.status !== 'proven' && typeof c.criterion === 'string');
  return {
    value: bag.value,
    at: typeof bag.at === 'string' && !Number.isNaN(Date.parse(bag.at)) ? new Date(bag.at) : null,
    proven: typeof bag.proven === 'number' ? bag.proven : null,
    total: typeof bag.total === 'number' ? bag.total : null,
    note: typeof bag.note === 'string' && bag.note.trim() ? bag.note : null,
    open: open ? String(open.criterion) : null,
  };
}

/**
 * What QA found, in a few words: "approved 6 of 6", "sent back: <the line it
 * could not prove>".
 * @param v - The verdict.
 */
function verdictWords(v: Verdict): string {
  const count = v.proven !== null && v.total !== null ? `${v.proven} of ${v.total}` : null;
  if (v.value === 'approve') {
    return count ? `approved ${count}` : 'approved';
  }
  const why = v.open ?? v.note?.split(/(?<=[.;])\s/)[0] ?? null;
  const word = v.value === 'reject' ? 'rejected' : 'sent back';
  return why ? `${word}: ${clip(why)}` : count ? `${word} · ${count} proven` : word;
}

/**
 * "seen 4 of 4", "partly seen 2 of 4", "not seen".
 * @param release - The release reading.
 */
function seenWords(release: ReportReleaseSummary): string | null {
  const s = release.seen;
  if (!s || s.state === 'pending') {
    return null;
  }
  const count = s.reached !== undefined && s.total !== undefined && s.total > 0 ? ` ${s.reached} of ${s.total}` : '';
  return s.state === 'seen' ? `seen${count}` : s.state === 'partial' ? `partly seen${count}` : 'not seen';
}

/**
 * The run that wrote something stamped `at`, or null: the one running when it
 * was stamped, else the one that ended last before it, within a recording
 * pass (a required tool's pass runs after the run it records for).
 * @param runs - The candidates.
 * @param at - The stamp.
 */
function writerOf(runs: readonly ReportActivity[], at: number | null): ReportActivity | null {
  if (at === null) {
    return null;
  }
  const span = (r: ReportActivity) => ({ start: time(r.startedAt ?? r.at) ?? 0, end: time(r.endedAt) ?? Number.POSITIVE_INFINITY });
  const during = runs.filter((r) => {
    const s = span(r);
    return at >= s.start - 1000 && at <= s.end;
  });
  if (during.length > 0) {
    return during.sort((a, b) => span(b).start - span(a).start)[0]!;
  }
  return runs
    .filter(r => span(r).end < at && at - span(r).end <= WROTE_AFTER_MS)
    .sort((a, b) => span(b).end - span(a).end)[0] ?? null;
}

/**
 * The tone of an attempt, and its word: passed, sent back, failed, building.
 * @param a - The attempt.
 * @param v - QA's verdict on its task.
 * @param merged - Whether its pull request merged.
 */
function attemptState(a: ReportAttempt, v: Verdict | null, merged: boolean): { word: string; tone: Tone } {
  if (a.live) {
    return { word: a.status === 'queued' ? 'queued' : 'building', tone: 'info' };
  }
  if (merged || v?.value === 'approve') {
    return { word: 'passed', tone: 'ok' };
  }
  if (v?.value === 'changes') {
    return { word: 'sent back', tone: 'warn' };
  }
  if (v?.value === 'reject') {
    return { word: 'rejected', tone: 'bad' };
  }
  if (!a.executed) {
    return { word: 'did not start', tone: 'muted' };
  }
  return a.tone === 'bad' ? { word: 'failed', tone: 'bad' } : a.status === 'cancelled' ? { word: 'cancelled', tone: 'muted' } : { word: a.outcome.toLowerCase(), tone: a.tone };
}

/**
 * Sum the cents that are known; null when none is.
 * @param values - Cents, null where not recorded.
 */
function sum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === 'number');
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * Newest first; undated rows last, in the order they were made.
 * @param rows - The rows.
 */
function newestFirst(rows: HistoryRow[]): HistoryRow[] {
  return rows
    .map((r, i) => ({ r, i, t: time(r.at) }))
    .sort((a, b) => (a.t !== null && b.t !== null ? b.t - a.t || a.i - b.i : a.t === null && b.t === null ? a.i - b.i : a.t === null ? 1 : -1))
    .map(x => x.r);
}

/**
 * The Timeline, newest first, and its cost foot.
 * @param input - The records the report was assembled from (runs oldest first).
 * @param ctx - What the report already read.
 * @param ctx.implementation - Every attempt.
 * @param ctx.release - Live, seen, the release's code.
 * @param ctx.mergedPrs - What merged.
 */
export function buildHistory(input: FeatureReportInput, ctx: { implementation: ReportImplementation; release: ReportReleaseSummary; mergedPrs: ReadonlySet<string> }): { rows: HistoryRow[]; cost: HistoryCost } {
  const activity = input.activity ?? [];
  const agents = activity.filter(a => a.kind === 'mission_run');
  const codeOf = (id: number) => input.codes?.get(id) ?? null;
  const taskById = new Map(input.tasks.map(t => [t.id, t]));
  const attempts = ctx.implementation.attempts;
  const of = attempts.length;
  const used = new Set<number>();
  const rows: HistoryRow[] = [];

  // EACH ATTEMPT, ONE GROUP: its build, and QA's reviews of it.
  for (const a of attempts) {
    const task = a.taskId !== null ? taskById.get(a.taskId) : undefined;
    const verdict = verdictOf(task);
    const merged = a.prUrl !== null && ctx.mergedPrs.has(a.prUrl);
    const build: HistoryRow = {
      key: `build-${a.runId}`,
      kind: 'build',
      title: runTitle({ kind: 'build', status: a.status, executed: a.executed, attempt: a.n, of, prUrl: a.prUrl, checks: a.checks, failedChecks: a.failedChecks }),
      code: nounCode('run', a.runId),
      at: iso(a.at),
      tone: a.live ? 'info' : a.tone,
      cents: a.cents,
      open: { type: 'worker_run', id: String(a.runId) },
      href: null,
      live: a.live,
    };
    // QA's reviews of this attempt: the agent runs that named its task. The
    // one that wrote the task's verdict carries what it found.
    const reviewers = a.taskId === null ? [] : agents.filter(r => (r.touched ?? []).includes(a.taskId!) && !used.has(r.id));
    const writer = verdict ? writerOf(reviewers, time(verdict.at)) : null;
    const reviews: HistoryRow[] = reviewers.map((r) => {
      used.add(r.id);
      return agentRow(r, { attempt: a.n, result: r === writer && verdict ? verdictWords(verdict) : null, tone: r === writer && verdict ? (verdict.value === 'approve' ? 'ok' : 'warn') : undefined });
    });
    const state = attemptState(a, verdict, merged);
    const cents = sum([a.cents, ...reviews.map(r => r.cents)]);
    rows.push({
      key: `attempt-${a.runId}`,
      kind: 'attempt',
      title: [`Attempt ${a.n} of ${Math.max(of, a.n)}`, state.word].join(' · '),
      code: task ? codeOf(task.id) : null,
      // The group stands where its newest row does.
      at: [build, ...reviews].map(r => r.at).filter((t): t is string => t !== null).sort().at(-1) ?? null,
      tone: state.tone,
      cents,
      open: null,
      href: null,
      live: a.live,
      children: newestFirst([build, ...reviews]),
    });
  }

  // THE PLANS: written, then approved.
  for (const plan of input.plans) {
    const approvedAt = typeof plan.meta.approvedAt === 'string' ? plan.meta.approvedAt : null;
    const by = typeof plan.meta.approvedBy === 'string' ? plan.meta.approvedBy : null;
    const who = by === null ? null : by.startsWith('agent:') || by.startsWith('factory:') ? null : input.people?.[by] ?? null;
    if (approvedAt) {
      rows.push({
        key: `plan-approved-${plan.id}`,
        kind: 'plan',
        title: who ? `${who} approved the plan` : 'Plan approved on the trust bar',
        code: codeOf(plan.id),
        at: approvedAt,
        tone: 'ok',
        cents: null,
        open: { type: 'object', id: String(plan.id) },
        href: null,
        live: false,
      });
    }
  }

  // EVERY OTHER AGENT RUN: what it did, and what the record it wrote says.
  const live = readRequestLive(input.request.meta);
  const rest = agents.filter(r => !used.has(r.id));
  const liveWriter = writerOf(rest, time(live?.checkedAt ?? null));
  const planOf = new Map(input.plans.flatMap((p) => {
    const w = writerOf(rest, time(p.createdAt));
    return w ? [[w.id, p] as const] : [];
  }));
  for (const r of rest) {
    const plan = planOf.get(r.id);
    const checkedLive = r === liveWriter ? seenWords(ctx.release) : null;
    const result = checkedLive ?? (plan ? codeOf(plan.id) : null);
    rows.push(agentRow(r, { result, kind: checkedLive ? 'live' : plan ? 'plan' : 'agent', tone: checkedLive ? (ctx.release.seen?.state === 'seen' ? 'ok' : 'warn') : undefined }));
  }

  // THE CONVERSATIONS, where it started among them.
  for (const c of activity.filter(x => x.kind === 'conversation')) {
    rows.push({
      key: `chat-${c.id}${c.origin ? '-origin' : ''}`,
      kind: 'conversation',
      title: c.title,
      code: nounCode('conversation', c.id),
      at: iso(c.at),
      tone: 'muted',
      cents: c.cents ?? null,
      open: { type: 'conversation', id: String(c.id) },
      href: null,
      live: false,
    });
  }

  // THE MERGE AND THE DEPLOY IT STARTED, as the request recorded them.
  const delivery = readDelivery(input.request.meta);
  if (delivery) {
    rows.push({
      key: 'merge',
      kind: 'merge',
      title: [`Merged ${delivery.pr ?? prNumberLabel(delivery.prUrl) ?? 'the pull request'}`, delivery.mergedBy ? `by ${input.people?.[delivery.mergedBy] ?? delivery.mergedBy}` : null].filter(Boolean).join(' · '),
      code: null,
      at: delivery.mergedAt,
      tone: 'ok',
      cents: null,
      open: null,
      href: delivery.prUrl,
      live: false,
    });
    for (const run of delivery.runs) {
      const going = run.conclusion === null && run.status !== 'completed';
      const ok = run.conclusion === 'success';
      rows.push({
        key: `deploy-${run.runId}`,
        kind: 'deploy',
        title: going ? `Deploying · ${run.name ?? 'run'}` : ok ? `Deployed · ${run.name ?? 'run'}` : `${run.name ?? 'Deploy'} ${run.conclusion ?? 'ended'}`,
        code: run.runNumber !== null ? `#${run.runNumber}` : null,
        at: run.startedAt,
        tone: going ? 'info' : ok ? 'ok' : 'bad',
        cents: null,
        open: null,
        href: run.url,
        live: going,
      });
    }
  }

  // THE RELEASE, and the live check when no agent row already said it.
  for (const release of input.releases) {
    const at = typeof release.meta.releasedAt === 'string' ? release.meta.releasedAt : iso(release.createdAt);
    rows.push({
      key: `release-${release.id}`,
      kind: 'release',
      title: 'Released',
      code: codeOf(release.id),
      at,
      tone: 'ok',
      cents: null,
      open: { type: 'object', id: String(release.id) },
      href: null,
      live: false,
    });
  }
  if (live && !liveWriter) {
    const words = seenWords(ctx.release);
    rows.push({
      key: 'live-check',
      kind: 'live',
      title: words ? `Live check · ${words}` : live.line,
      code: null,
      at: live.checkedAt,
      tone: live.state === 'seen' ? 'ok' : 'warn',
      cents: null,
      open: live.releaseId ? { type: 'object', id: String(live.releaseId) } : null,
      href: null,
      live: false,
    });
  }

  // THE FACTORY'S OWN NOTES — why it planned first, a paused automation it
  // would have run — kept when no typed row stands at the same moment. A
  // line about a run is that run's row; a line beside a typed row ("Shipped
  // in release #375" beside the release) is the same event said twice.
  // A note beside a typed row is folded under it, so nothing it says is lost
  // and nothing is listed twice; the side panel shows it.
  const typed = rows.filter(r => r.at !== null);
  for (const [i, line] of readRecovery(input.request.meta).log.entries()) {
    const at = time(line.at);
    if (line.runId || at === null) {
      continue;
    }
    // A person is named, never their id.
    const text = Object.entries(input.people ?? {}).reduce((s, [id, name]) => s.split(id).join(name), line.text);
    const beside = typed
      .map(r => ({ r, gap: Math.abs((time(r.at) ?? 0) - at) }))
      .filter(x => x.gap <= NOTE_NEAR_MS)
      .sort((a, b) => a.gap - b.gap)[0]
      ?.r;
    if (beside) {
      beside.notes = [...(beside.notes ?? []), text];
      continue;
    }
    rows.push({ key: `note-${i}`, kind: 'note', title: text, code: null, at: line.at, tone: 'muted', cents: null, open: null, href: null, live: false });
  }

  const flat = rows.flatMap(r => (r.children ? r.children : [r]));
  const builds = sum(flat.filter(r => r.kind === 'build').map(r => r.cents));
  const agentCents = sum(flat.filter(r => r.kind === 'review' || r.kind === 'agent' || r.kind === 'plan' || r.kind === 'live').map(r => r.cents));
  const chat = sum(flat.filter(r => r.kind === 'conversation').map(r => r.cents));
  return {
    rows: newestFirst(rows),
    cost: {
      totalCents: (builds ?? 0) + (agentCents ?? 0) + (chat ?? 0),
      split: [
        { key: 'builds', label: 'Builds', cents: builds },
        { key: 'agents', label: 'Agents', cents: agentCents },
        { key: 'chat', label: 'Chat', cents: chat },
      ],
    },
  };
}

/**
 * One agent run as a row.
 * @param r - The run.
 * @param o - What the Timeline knows about it.
 * @param o.attempt - The attempt it reviewed.
 * @param o.result - What the record it wrote says.
 * @param o.kind - Which kind of row.
 * @param o.tone - Its tone, when what it wrote says one.
 */
function agentRow(r: ReportActivity, o: { attempt?: number; result?: string | null; kind?: HistoryRow['kind']; tone?: Tone }): HistoryRow {
  const status = r.runStatus ?? r.status ?? 'completed';
  const going = ['planning', 'running', 'paused', 'awaiting_review'].includes(status);
  return {
    key: `agent-${r.id}`,
    kind: o.kind ?? (o.attempt ? 'review' : 'agent'),
    title: runTitle({ kind: 'agent', status, label: r.label, doing: r.doing, attempt: o.attempt ?? null, result: o.result, stored: r.stored ?? r.title }),
    code: nounCode('run', r.id),
    at: iso(r.endedAt ?? r.at),
    tone: o.tone ?? (going ? 'info' : status === 'completed' ? 'muted' : 'bad'),
    cents: r.cents ?? null,
    open: { type: 'mission_run', id: String(r.id) },
    href: null,
    live: going,
  };
}

/**
 * The Timeline's foot in words: "$2.77 in all · builds $2.77 · agents not
 * recorded". A kind with nothing costed says so — never $0.00.
 * @param cost - The foot.
 * @param money - How cents are written.
 */
export function historyCostLine(cost: HistoryCost, money: (cents: number) => string): string {
  return [
    `${money(cost.totalCents)} in all`,
    ...cost.split.map(s => `${s.label.toLowerCase()} ${s.cents === null ? 'not recorded' : money(s.cents)}`),
  ].join(' · ');
}
