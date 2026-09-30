import { describeRef } from '@/libs/preview/describeRef';
import { isLiveStatus } from '@/libs/worker/runLog';

/**
 * WHERE THIS IS, IN THREE LINES — You, Now, Next (Chris, 2026-09-30: "a simple
 * and elegant solution so I understand when I'm waiting. What's next. What's
 * running.").
 *
 *   - **You** — "Nothing needs you", or "Needs you: <the one move>".
 *   - **Now** — exactly what is running, and true: "Waiting for a worker"
 *     while a run is queued and nobody has claimed it, "Engineer building"
 *     once a worker has, "Writing the plan" while the planning run works,
 *     "QA reviewing PR #135" while the reviewer does. Each names its run and
 *     counts from the right moment: a queued run from when it was queued, a
 *     build from when a worker claimed it. "Nothing running" otherwise.
 *   - **Next** — what happens after the current step, read from the stage.
 *
 * One typed read, drawn by one component (`features/dashboard/factory/LiveStatus`)
 * on the feature page, under the chat turn that filed the work, at the top of
 * the preview pane and on each Work row; the API (`GET /api/v1/objects/:id/status`)
 * and MCP (`read_object`) return the same shape (parity rule).
 *
 * Pure and client-safe: the report assembles it (`services/factory/featureReport.ts`),
 * the Work queue batches it (`services/factory/liveStatusData.ts`).
 *
 * Nothing here names an automation, an object type or a tool. A run is live
 * because its own status says so (`isLiveStatus`); what kind of work it is
 * comes from the stage the record is in — planning, awaiting review — never
 * from which automation fired it.
 */

/** What the running thing is doing, as the Now line names it. */
export type LiveKind = 'queued' | 'building' | 'planning' | 'reviewing' | 'working';

/** The Now line: the one run carrying the work right now. */
export type LiveRun = {
  kind: LiveKind;
  /** "Waiting for a worker", "Engineer building", "Writing the plan", "QA reviewing PR #135". */
  label: string;
  /** The run's own last word — its heartbeat step, or the mission task it is on. */
  step: string | null;
  /** Which run, so the line can open it in the preview pane. */
  runRef: { type: 'worker_run' | 'mission_run'; id: string };
  /** The run's own page (`libs/preview/describeRef.ts`). */
  runHref: string;
  /** "Run #432", "Agent run #6414". */
  runLabel: string;
  /** ISO — when the clock this line shows started: queued at, claimed at, started at. */
  startedAt: string;
  /** Which moment `startedAt` is, so the line says "queued 3 min" and never "started" for a run nobody took. */
  since: 'queued' | 'claimed' | 'started';
};

/** The You line. */
export type StatusYou = {
  needsYou: boolean;
  /** "Nothing needs you" or "Needs you: Build again". */
  line: string;
  /** Why, when it needs you: the open question, or what stopped. */
  why: string | null;
};

/** A move, as a surface off the record's own page can follow it. */
export type StatusMove = { label: string; href: string };

/**
 * One record's status, portable: what the API returns, what the chat chip
 * polls, what the preview pane and the Work row draw.
 */
export type RecordStatus = {
  record: { id: number; objectType: string; title: string; href: string };
  /** The stage badge — "Planning", "Waiting for a worker", "Ready to merge". */
  stage: { key: string; label: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted' };
  you: StatusYou & { move: StatusMove | null };
  /** The Now line; null when nothing is running. Pollers stop when it is null. */
  live: LiveRun | null;
  next: string | null;
  /** ISO — when this was read. */
  readAt: string;
};

/** A worker run, narrowed to what the Now line reads. */
export type LiveWorkerRunInput = {
  id: number;
  status: string;
  createdAt: Date;
  claimedAt: Date | null;
  progress: Record<string, unknown>;
  /** Which attempt this is, 1-based, for "Building attempt 2". */
  n: number;
};

/** A mission (agent) run working on the record. */
export type LiveMissionRunInput = {
  id: number;
  status: string;
  title: string;
  startedAt: Date;
  /** The plan task it is on, when its plan says. */
  step: string | null;
  /** Found by the automation fire that names this record in its input — the run started FOR it. */
  forRecord: boolean;
};

/** The stage the record is in, which says what a live agent run is doing. */
export type LiveContext = {
  /** A plan is being written before the build. */
  planning: boolean;
  /** The change is waiting on QA; the PR, when one is known ("PR #135"). */
  reviewing: { pr: string | null } | null;
};

const WORKER_LIVE = new Set(['queued', 'claimed', 'running', 'paused']);

/**
 * "PR #135" from a pull request URL, or null.
 * @param url - The PR URL.
 */
export function prLabel(url: string | null | undefined): string | null {
  const n = url ? /\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1] : undefined;
  return n ? `PR #${n}` : null;
}

/**
 * A run's own page — the one rule every surface uses (`describeRef`).
 * @param type - Which kind of run.
 * @param id - Its id.
 */
function runHref(type: 'worker_run' | 'mission_run', id: number): string {
  return describeRef({ type, id: String(id) }).href ?? '';
}

/**
 * The one run carrying the work right now, or null. A build a worker has
 * claimed leads, then an agent run working on it, then a build still queued.
 * @param input - The runs and the stage.
 * @param input.workerRuns - The record's engineering runs.
 * @param input.missionRuns - Agent runs working on it.
 * @param input.context - The stage it is in.
 */
export function pickLive(input: { workerRuns: readonly LiveWorkerRunInput[]; missionRuns: readonly LiveMissionRunInput[]; context: LiveContext }): LiveRun | null {
  const workers = input.workerRuns.filter(r => WORKER_LIVE.has(r.status)).sort((a, b) => b.id - a.id);
  const claimed = workers.find(r => r.claimedAt !== null);
  if (claimed) {
    const step = typeof claimed.progress.step === 'string' && claimed.progress.step.trim() ? claimed.progress.step.trim() : null;
    return {
      kind: 'building',
      label: claimed.status === 'paused' ? 'Engineer paused' : claimed.n > 1 ? `Engineer building attempt ${claimed.n}` : 'Engineer building',
      step,
      runRef: { type: 'worker_run', id: String(claimed.id) },
      runHref: runHref('worker_run', claimed.id),
      runLabel: `Run #${claimed.id}`,
      startedAt: claimed.claimedAt!.toISOString(),
      since: 'claimed',
    };
  }
  const agents = input.missionRuns.filter(r => isLiveStatus(r.status)).sort((a, b) => Number(b.forRecord) - Number(a.forRecord) || b.id - a.id);
  const agent = agents[0];
  if (agent) {
    const kind: LiveKind = input.context.planning ? 'planning' : input.context.reviewing ? 'reviewing' : 'working';
    const label = kind === 'planning'
      ? 'Writing the plan'
      : kind === 'reviewing'
        ? `QA reviewing${input.context.reviewing?.pr ? ` ${input.context.reviewing.pr}` : ''}`
        : agent.title;
    return {
      kind,
      label,
      step: agent.step,
      runRef: { type: 'mission_run', id: String(agent.id) },
      runHref: runHref('mission_run', agent.id),
      runLabel: `Agent run #${agent.id}`,
      startedAt: agent.startedAt.toISOString(),
      since: 'started',
    };
  }
  const queued = workers[0];
  if (queued) {
    return {
      kind: 'queued',
      label: 'Waiting for a worker',
      step: null,
      runRef: { type: 'worker_run', id: String(queued.id) },
      runHref: runHref('worker_run', queued.id),
      runLabel: `Run #${queued.id}`,
      startedAt: queued.createdAt.toISOString(),
      since: 'queued',
    };
  }
  return null;
}

/**
 * "45s", "3 min", "1 h 12 min" — how long the Now line has been true.
 * @param ms - Milliseconds.
 */
export function elapsedLabel(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min} min`;
  }
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/**
 * The Now line in words, for a surface that draws one string (a Work row,
 * MCP): "Waiting for a worker · run #432 · queued 3 min".
 * @param live - The live run, or null.
 * @param now - The clock.
 */
export function nowLine(live: LiveRun | null, now: Date): string {
  if (!live) {
    return 'Nothing running';
  }
  const elapsed = elapsedLabel(now.getTime() - new Date(live.startedAt).getTime());
  const clock = live.since === 'queued' ? `queued ${elapsed}` : elapsed;
  return [live.label, live.step, clock].filter(Boolean).join(' · ');
}

/**
 * The You line from what the record says it wants.
 * @param needsYou - Whether a person is holding it.
 * @param move - The one move, when there is one.
 * @param why - The question, or what stopped.
 */
export function youOf(needsYou: boolean, move: string | null, why: string | null): StatusYou {
  if (!needsYou) {
    return { needsYou: false, line: 'Nothing needs you', why: null };
  }
  return { needsYou: true, line: move ? `Needs you: ${move}` : 'Needs you', why: why?.trim() || null };
}

/**
 * A record a chat turn filed or changed, as the turn's typed `turn_records`
 * event carries it — the chat's microcard reads this, never the reply's words.
 */
export type TurnRecord = {
  id: number;
  title: string;
  href: string;
  /** True when the turn made it; false when it changed an existing one. */
  filed: boolean;
  /** What the change wrote, from the version it made: which fields, the new version, the history ref (`record_history:<id>@<v>`). */
  change: { fields: string[]; version: number; historyRef: string } | null;
  /** Whether its type has a report page, and so a status to read. */
  hasStatus: boolean;
};
