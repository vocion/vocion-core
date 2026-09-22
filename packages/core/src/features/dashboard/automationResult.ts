/**
 * One reading of an automation's result, shared by every surface that shows
 * one: the card, the run log, and the test-run panel.
 *
 * `summarizeResult` used to recognize `meetingsScanned` and nothing else — the
 * shape of the old deterministic discovery-sweep job — so every mission check
 * fell through it and rendered no summary at all.
 */

import type { PauseState } from './AutomationPauseControl';
import type { AutomationCheckResult } from '@/services/automations/checkSummary';
import type { AutomationControlResult, AutomationPause, AutomationSkipResult } from '@/services/AutomationService';

/** The discovery sweep's counts — the shape the page already knew. */
type SweepResult = { meetingsScanned: number; matched?: number; classified?: number };

function isCheckResult(result: unknown): result is AutomationCheckResult {
  const r = result as AutomationCheckResult | null;
  return !!r && typeof r === 'object' && r.kind === 'mission_check' && typeof r.missionRunId === 'number';
}

function isControlResult(result: unknown): result is AutomationControlResult {
  const r = result as AutomationControlResult | null;
  return !!r && typeof r === 'object' && r.kind === 'control' && (r.action === 'pause' || r.action === 'resume');
}

function isSkipResult(result: unknown): result is AutomationSkipResult {
  const r = result as AutomationSkipResult | null;
  return !!r && typeof r === 'object' && r.kind === 'skipped' && typeof r.detail === 'string';
}

function isSweepResult(result: unknown): result is SweepResult {
  return !!result && typeof result === 'object' && typeof (result as SweepResult).meetingsScanned === 'number';
}

/**
 * "2m 36s", "48s" — a duration a person reads rather than converts.
 * @param ms
 */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return null;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * The one-line summary of what a fire did.
 *
 * Mission checks read "2m 36s · 2 contacts in window · 0 queued"; the sweep
 * keeps its own counts; anything else returns null rather than a guess.
 * @param result - `automation_run.result`.
 */
export function summarizeResult(result: unknown): string | null {
  if (isControlResult(result)) {
    return summarizeControl(result);
  }
  if (isSkipResult(result)) {
    return summarizeSkip(result);
  }
  if (isCheckResult(result)) {
    const c = result.counts;
    return [
      formatDuration(result.durationMs),
      coalescedNote(result),
      c.contactsInWindow === null ? null : `${c.contactsInWindow} contact${c.contactsInWindow === 1 ? '' : 's'} in window`,
      `${c.queued} queued`,
      c.briefed > 0 ? `${c.briefed} briefed` : null,
      c.drafted > 0 ? `${c.drafted} drafted` : null,
      result.tasks.failed > 0 ? `${result.tasks.failed} task${result.tasks.failed === 1 ? '' : 's'} failed` : null,
    ].filter(Boolean).join(' · ');
  }
  if (isSweepResult(result)) {
    return `${result.meetingsScanned} scanned · ${result.matched ?? 0} matched · ${result.classified ?? 0} classified`;
  }
  return null;
}

/**
 * "Paused by Chris — waiting on the CRM fix" / "Resumed by Chris". The
 * person's name rides the row itself, so this reads after the user is gone.
 * @param result - A `control` row's `result`.
 */
export function summarizeControl(result: AutomationControlResult): string {
  const who = result.by.name ?? result.by.id;
  const head = `${result.action === 'pause' ? 'Paused' : 'Resumed'} by ${who}`;
  const note = result.note ? ` — ${result.note}` : '';
  const schedule = result.schedule === 'unreachable' ? ' (Temporal was unreachable; the next apply carries the state in)' : '';
  return `${head}${note}${schedule}`;
}

/**
 * "Not fired — its own run's event: …" / "Held — over 6 fires in ten
 * minutes; covered by run 2570". The rule that held, in the log's own words.
 * @param result - A `skipped` row's `result`.
 */
export function summarizeSkip(result: AutomationSkipResult): string {
  if (result.reason === 'rate_limited') {
    const covered = result.coalescedInto ? `; covered by run ${result.coalescedInto}` : '';
    return `Held — ${result.detail}${covered}`;
  }
  return `Not fired — ${result.detail}`;
}

/**
 * "covers 4 held fires" when a run stood in for the fires the ceiling held.
 * @param result - Any fire's `result`.
 */
function coalescedNote(result: unknown): string | null {
  const n = (result as { coalesced?: unknown } | null)?.coalesced;
  return typeof n === 'number' && n > 0 ? `covers ${n} held fire${n === 1 ? '' : 's'}` : null;
}

/**
 * The refusal a row records, or null for a fire.
 * @param result
 */
export function skipResultOf(result: unknown): AutomationSkipResult | null {
  return isSkipResult(result) ? result : null;
}

/**
 * The control a row records, or null for a fire.
 * @param result
 */
export function controlResultOf(result: unknown): AutomationControlResult | null {
  return isControlResult(result) ? result : null;
}

/**
 * The mission run a fire started, for the link to its full prose report.
 * @param result
 */
export function checkResultOf(result: unknown): AutomationCheckResult | null {
  return isCheckResult(result) ? result : null;
}

/**
 * Where a fire's own detail page is, by kind. Null when the kind has no run page (jobs).
 * @param kind
 * @param targetRunId
 */
export function targetRunHref(kind: string, targetRunId: number | null): string | null {
  if (targetRunId === null || targetRunId === 0) {
    return null;
  }
  if (kind === 'mission_check') {
    return `/dashboard/missions/runs/${targetRunId}`;
  }
  return null;
}

/**
 * `automation:<slug>` / `dashboard:test-run` as something a column can show.
 * @param invokedBy
 */
export function invokedByLabel(invokedBy: string | null): string {
  if (!invokedBy) {
    return 'unknown';
  }
  if (invokedBy.startsWith('automation:')) {
    return 'schedule';
  }
  if (invokedBy === 'dashboard:test-run') {
    return 'test run';
  }
  if (invokedBy === 'event:coalesced') {
    return 'coalesced fires';
  }
  if (invokedBy.startsWith('user:')) {
    return 'a person';
  }
  return invokedBy;
}

/**
 * The pause as the control shows it, formatted once on the server so the
 * card, the detail page and the client component agree on the words.
 * @param pause - From `pausesFor`.
 */
export function pauseStateOf(pause: AutomationPause): PauseState {
  return {
    byName: pause.by.name ?? pause.by.id,
    when: pause.at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    note: pause.note,
  };
}
