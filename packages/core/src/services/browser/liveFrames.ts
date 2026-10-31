/**
 * THE LIVE PICTURE, READ — which browser a run drives, and its latest frame,
 * without the engine. The engine (`browserEngine.ts`) keeps its open browsers
 * on the process (`globalThis.__vocionBrowserSessions`); a page, the frame
 * route or an automation's queue only reads that map, so it compiles this and not
 * Playwright or the practice sites (the build budget, CI.yml "Build memory").
 */

import type { Buffer } from 'node:buffer';

/** What a reader needs of an open browser. */
type Held = { frame: Buffer | null; frameSeq: number; page: { isClosed: () => boolean; url: () => string } };

function held(): Map<string, Held> {
  return ((globalThis as { __vocionBrowserSessions?: Map<string, Held> }).__vocionBrowserSessions ??= new Map());
}

/**
 * The person's browser key.
 * @param orgId - The workspace.
 * @param userId - The person.
 */
export function personKey(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

/**
 * The browser a run drives: the person's own, or — for a run of an automation — one of its own.
 * @param row - The run.
 * @param row.orgId - Its workspace.
 * @param row.userId - Its person.
 * @param row.id - The run.
 * @param row.routineRunId - The automation run it is, when one.
 */
export function sessionKeyOf(row: { orgId: string; userId: string; id: number; routineRunId?: number | null }): string {
  return row.routineRunId ? `${row.orgId}:run:${row.id}` : personKey(row.orgId, row.userId);
}

/**
 * The live picture, or null when there is no browser or no frame yet.
 * @param key - The browser.
 */
export function latestFrame(key: string): { jpeg: Buffer; seq: number } | null {
  const s = held().get(key);
  return s?.frame ? { jpeg: s.frame, seq: s.frameSeq } : null;
}

/**
 * The frame counter, so the run's view can say when the picture moved.
 * @param key - The browser.
 */
export function frameSeq(key: string): number {
  return held().get(key)?.frameSeq ?? 0;
}

/**
 * Where the browser is, when it is open.
 * @param key - The browser.
 */
export function whereNow(key: string): { url: string; title: string } | null {
  const s = held().get(key);
  if (!s || s.page.isClosed()) {
    return null;
  }
  return { url: s.page.url(), title: '' };
}
