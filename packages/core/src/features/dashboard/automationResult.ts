/**
 * One reading of an automation's result, shared by every surface that shows
 * one: the card, the run log, and the test-run panel.
 *
 * `summarizeResult` used to recognize `meetingsScanned` and nothing else — the
 * shape of the old deterministic discovery-sweep job — so every mission check
 * fell through it and rendered no summary at all.
 */

import type { AutomationCheckResult } from '@/services/automations/checkSummary';

/** The discovery sweep's counts — the shape the page already knew. */
type SweepResult = { meetingsScanned: number; matched?: number; classified?: number };

function isCheckResult(result: unknown): result is AutomationCheckResult {
  const r = result as AutomationCheckResult | null;
  return !!r && typeof r === 'object' && r.kind === 'mission_check' && typeof r.missionRunId === 'number';
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
  if (isCheckResult(result)) {
    const c = result.counts;
    return [
      formatDuration(result.durationMs),
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
  return invokedBy;
}
