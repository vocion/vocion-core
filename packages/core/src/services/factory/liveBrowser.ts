/**
 * THE LIVE CHECK'S BROWSER: one session per run, driven by QA through the
 * `browser_*` tools, the way Playwright MCP drives one. QA reads the page's
 * accessibility snapshot, where every element it can act on carries a ref
 * (`button "Save" [disabled] [ref=e5]`), and acts by ref. Every snapshot,
 * screenshot, response and action gets an id on the session, and
 * `record_live_check` takes those ids as the evidence for each acceptance line.
 *
 * Why (Chris, 2026-10-03, FE-402 line 6): the step language this replaces had
 * QA write `click: "Save"` for "a blank name is not saved". Save was correctly
 * disabled, the click waited 15 s, and the line read not reached: a correct
 * feature reported broken. In a snapshot QA sees the button is disabled, and a
 * click on a disabled control answers "disabled" at once.
 *
 * Where it may go: only the release's product's own origins (each
 * environment's address and its sign-in page). A navigation of the page to
 * any other origin is aborted and said. Signing in uses the product's stored
 * QA credential, read here and typed into the sign-in page; it never reaches a
 * tool's answer, a record or a log line.
 *
 * Lifetime: a session is keyed by the run (or, outside a run, the
 * conversation), closed when the run's check ends (`closeBrowserSession`,
 * called by the automation), its browser contexts closed after an idle
 * minute count, and dropped altogether after a few hours. Sessions live in
 * this process: the tools of one run execute where the run's tool calls land,
 * and a screenshot's id is checkable from the database even when the session
 * is gone (`shot-<artifact id>`).
 *
 * Recording (Chris, 2026-10-03): every page QA drives is recorded (Playwright's
 * `recordVideo`, at the viewport's size). When a tab's context closes its video
 * is set aside, and when the session closes each one is kept by the media store
 * and filed on every request the release shipped and on the release
 * (`qa-live-video`), captioned "Live check of REL-<n>, <date>". The sign-in
 * page is never kept: only pages QA opened after signing in are. A recording
 * that cannot be kept is logged and said on the request; it never fails or
 * holds up the check. `VOCION_LIVE_CHECK_VIDEO=0` turns recording off.
 *
 * The feature demo (Chris, 2026-10-03: "the demo video should be designed to
 * demonstrate functionality to a PM/PO … the happy path, end to end"): a tab
 * opened with `demoForRequest` records that one request's demo. Each action in
 * it may carry `say` — what QA tells the viewer at that moment — and
 * `browser_say` speaks a line on its own. A said line is logged at the moment
 * the state it describes is on screen, and the tab then holds that state for
 * as long as the line takes to say (`spokenMs`), so the picture never moves on
 * before the words do. When the session closes, the demo tab's video is filed
 * on its request alone as `feature-demo`, carrying the said lines as its
 * script, timed from the video's start; the narration speaks that script as
 * written instead of guessing one from the timeline.
 */

import type { Buffer } from 'node:buffer';
import type { Browser, BrowserContext, Locator, Page, Video } from 'playwright';
import type { AcceptanceLine, LiveReason } from '@/libs/factory/liveCheck';
import type { TimelineMoment } from '@/services/artifacts/recordings';
import type { Author } from '@/services/ArtifactService';
import type { EnvironmentAccess } from '@/services/factory/productAccess';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { hrefLeadingTo, HUMAN_BEATS } from '@/libs/factory/demoNavigation';
import { LIVE_ROLE } from '@/libs/factory/liveCheck';
import { snapshotWindow } from '@/libs/factory/snapshotWindow';
import { CURSOR_GLIDE_MS, DEMO_CHROME_SCRIPT } from '@/libs/media/demoChrome';
import { spokenMs } from '@/libs/media/narration';
import { allowedOrigins, environmentFor, releaseLines, signIn, signInProblem } from './liveCheck';

/** The two viewports QA may open a page at — the runner's own sizes (`packages/runner/src/qa.mjs` VIEWPORTS). */
export const BROWSER_VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
} as const;
export type BrowserViewport = keyof typeof BROWSER_VIEWPORTS;

/** What one session may do. */
/** Why recording failed on this process, once it has; later sessions check without it. */
let recordingBroken: string | null = null;

/** Forget a failed recording probe (tests, and a process whose installation changed). */
export function resetRecordingProbe(): void {
  recordingBroken = null;
}

export const BROWSER_LIMITS = {
  /** Browser contexts (an environment × viewport × signed in or not). */
  contexts: 6,
  /** Tool calls on one session. */
  actions: 200,
  /** Characters of snapshot returned in one answer. */
  snapshotChars: 12_000,
  /** Responses kept per session. */
  responses: 400,
  /** Contexts close after this long unused (the evidence stays). */
  idleMs: 10 * 60_000,
  /**
   * A demo tab closes this soon after its last action (2026-10-05: five demos recorded in parallel
   * each kept ten idle minutes of a still page, the box spent half an hour encoding them before
   * any could be filed, and the narrated video ended on a spinner). Long enough for QA to think
   * between steps; a story that pauses longer opens a new take, and the takes are stitched.
   */
  demoIdleMs: 2 * 60_000,
  /** A session is dropped this long after its last use. */
  ttlMs: 3 * 60 * 60_000,
  /** How long a click or a typed value may wait for its target. */
  actMs: 10_000,
} as const;

/** One thing captured in a session, citable by its id. */
export type BrowserEvidence
  = | { id: string; kind: 'snapshot'; at: string; url: string; title: string; viewport: BrowserViewport; signedIn: boolean }
    | { id: string; kind: 'screenshot'; at: string; artifactId: number; url: string; pageUrl: string; caption: string; viewport: BrowserViewport; signedIn: boolean }
    | { id: string; kind: 'response'; at: string; method: string; url: string; status: number; signedIn: boolean }
    | { id: string; kind: 'action'; at: string; what: string; ok: boolean; detail: string | null; url: string | null }
    | { id: string; kind: 'said'; at: string; text: string; tab: string };

/** What a tab is for: QA's check of the acceptance lines, or one request's demo. */
export type TabPurpose = 'check' | 'demo';

type Tab = { key: string; env: EnvironmentAccess; viewport: BrowserViewport; signedIn: boolean; purpose: TabPurpose; requestId: number | null; context: BrowserContext; page: Page | null; videos: Array<{ video: Video; startedAt: string }>; openedAt: string };

/**
 * A tab's recording, set aside when its context closed, kept when the session
 * closes — with what QA did while it ran (`timeline`, ms from the video's
 * start), so a narration is timed to the moments it describes.
 */
export type SessionRecording = {
  path: string;
  viewport: BrowserViewport;
  signedIn: boolean;
  env: string;
  startedAt: string;
  endedAt: string;
  timeline: TimelineMoment[];
  /** QA's check (filed on every shipped request and the release), or one request's demo (filed on that request). */
  purpose: TabPurpose;
  /** The request a demo shows; null for the check. */
  requestId: number | null;
  /** What QA said while a demo ran, each line at its moment from the video's start: the narration's script. */
  script: Array<{ atMs: number; text: string }>;
};

type Session = {
  key: string;
  orgId: string;
  releaseId: number;
  product: string;
  /** The requests the release shipped: the ones a demo may be recorded for. */
  requestIds: number[];
  envs: EnvironmentAccess[];
  origins: Set<string>;
  tabs: Map<string, Tab>;
  current: string | null;
  seq: number;
  evidence: Map<string, BrowserEvidence>;
  responses: string[];
  /** What stopped the check from looking (a failed sign-in), cleared once it looks signed in. */
  problems: LiveReason[];
  /** A navigation to another origin the guard aborted, said on the next answer. */
  blocked: string[];
  actions: number;
  lastUsed: number;
  idle: ReturnType<typeof setTimeout> | null;
  /** Where this session's videos are written, or null when it does not record. */
  videoDir: string | null;
  recordings: SessionRecording[];
  deps: LiveBrowserDeps;
};

/** What a session needs from outside, so a test can stand in for the browser and the store. */
export type LiveBrowserDeps = {
  browser: () => Promise<Browser>;
  store: (orgId: string, png: Buffer) => Promise<{ url: string; filename: string; bytes: number; contentType: string }>;
  now: () => Date;
  /** The directory a session's videos go to, or null to record nothing. */
  videoDir: (key: string) => string | null;
  /** Keep a closed session's recordings (the media store, filed on the requests and the release). */
  keepRecordings: (orgId: string, releaseId: number, recordings: SessionRecording[], now: Date) => Promise<void>;
  /** Hold a demo's screen for this long while a said line is spoken. */
  dwell: (ms: number) => Promise<void>;
};

const defaultDeps: LiveBrowserDeps = {
  browser: async () => (await import('@/libs/documents/render')).sharedBrowser(),
  store: async (orgId, png) => {
    const { saveArtifact } = await import('@/libs/tools/artifacts/store');
    const f = await saveArtifact({ orgId, data: png, ext: 'png', contentType: 'image/png' });
    return { url: f.url, filename: f.filename, bytes: f.bytes, contentType: f.contentType };
  },
  now: () => new Date(),
  videoDir: key => process.env.VOCION_LIVE_CHECK_VIDEO === '0' ? null : path.join(tmpdir(), 'vocion-live-video', key.replace(/[^\w-]+/g, '_')),
  keepRecordings: async (orgId, releaseId, recordings, now) => (await import('./liveRecording')).keepLiveRecordings(orgId, releaseId, recordings, now),
  dwell: ms => new Promise(r => setTimeout(r, ms)),
};

const sessions = new Map<string, Session>();

/**
 * WHAT A DEMO LOOKS LIKE (Chris, 2026-10-04: "show mouse and movement, focus area when talking,
 * and click animation or ripple"). A headless recording shows no pointer, so the demo tab draws
 * its own: a cursor that glides to the target before each action, a ripple where it clicks, and a
 * spotlight that dims everything but the area being spoken about while a line is said. Injected
 * only into a demo tab's context — QA's check tab records the page as it is, nothing added.
 */
// The chrome itself lives in `libs/media/demoChrome.ts`, served to the runner too, so the
// preview demo recorded from a branch and the live demo look the same (Chris, 2026-10-05).

/**
 * The key as a viewer reads it on a keycap: arrows as arrows, Escape as Esc, a letter as itself.
 * @param keyName - Playwright's key name ("ArrowDown", "Escape", "s", "Shift+?", "Meta+K").
 */
export function keycapLabel(keyName: string): string {
  const one: Record<string, string> = { 'ArrowDown': '↓', 'ArrowUp': '↑', 'ArrowLeft': '←', 'ArrowRight': '→', 'Escape': 'Esc', 'Enter': 'Enter ↵', 'Backspace': '⌫', 'Delete': 'Del', 'Tab': 'Tab', ' ': 'Space', 'Space': 'Space', 'Meta': '⌘', 'Control': 'Ctrl', 'Alt': '⌥', 'Shift': '⇧' };
  return keyName.split('+').map(k => one[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join(' ');
}

/**
 * ONE ACTION AT A TIME, IN THE ORDER ASKED, per browser session. A model may send several browser
 * calls at once (FE-449's Feature Demo, 2026-10-04: four key presses landed within 7 ms, so the
 * shortcut sheet was open for one millisecond and every line described a screen already gone).
 * Each call waits here for the one before it — its action, its settle and its spoken hold.
 */
const lanes = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after every earlier call on this session has finished.
 * @param key - The session.
 * @param fn - The call.
 */
export function inOrder<T>(key: string | null, fn: () => Promise<T>): Promise<T> {
  const lane = key ?? '';
  const next = (lanes.get(lane) ?? Promise.resolve()).then(fn, fn);
  const settled = next.then(() => {}, () => {});
  lanes.set(lane, settled);
  void settled.then(() => {
    if (lanes.get(lane) === settled) {
      lanes.delete(lane);
    }
  });
  return next;
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Point the demo's cursor at the element and ripple on it; nothing on a check tab. Never throws:
 * the chrome is decoration, and a page that refuses it still gets its click.
 * @param tab - The tab.
 * @param rect - The element's box.
 * @param opts
 * @param opts.ripple
 */
async function demoPointAt(tab: Tab, rect: Rect | null, opts: { ripple?: boolean } = {}): Promise<void> {
  if (tab.purpose !== 'demo' || !rect || !tab.page) {
    return;
  }
  const x = Math.round(rect.x + rect.width / 2);
  const y = Math.round(rect.y + rect.height / 2);
  try {
    await tab.page.evaluate(([px, py]) => (window as unknown as { __vocionDemo?: { moveTo: (x: number, y: number) => void } }).__vocionDemo?.moveTo(px, py), [x, y] as const);
    await tab.page.waitForTimeout(CURSOR_GLIDE_MS);
    if (opts.ripple !== false) {
      await tab.page.evaluate(([px, py]) => (window as unknown as { __vocionDemo?: { ripple: (x: number, y: number) => void } }).__vocionDemo?.ripple(px, py), [x, y] as const);
      await tab.page.waitForTimeout(120);
    }
  } catch {
    // decoration only
  }
}

/**
 * Light the area a spoken line is about (or clear it). Nothing on a check tab. Never throws.
 * @param tab - The tab.
 * @param rect - The area, or null to clear.
 */
async function demoSpotlight(tab: Tab, rect: Rect | null): Promise<void> {
  if (tab.purpose !== 'demo' || !tab.page) {
    return;
  }
  try {
    await tab.page.evaluate(r => (window as unknown as { __vocionDemo?: { spotlight: (r: Rect | null) => void } }).__vocionDemo?.spotlight(r), rect);
  } catch {
    // decoration only
  }
}

/**
 * The visible link on the open page that leads to the target, for a demo to click. Null when
 * none does, or the page cannot be read: the demo then goes straight there. Never throws.
 * @param tab - The demo tab.
 * @param target - Where it wants to go, absolute.
 */
async function linkOnScreen(tab: Tab, target: string): Promise<Locator | null> {
  if (!tab.page) {
    return null;
  }
  try {
    const hrefs = await tab.page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
    const href = hrefLeadingTo(hrefs, tab.page.url(), target);
    if (!href) {
      return null;
    }
    const loc = tab.page.locator(`a[href="${href.replace(/"/g, '\\"')}"]`).first();
    if (!(await loc.isVisible({ timeout: 1000 }).catch(() => false))) {
      return null;
    }
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    return loc;
  } catch {
    return null;
  }
}

/** How far into a step's line its action lands: the words lead, the change follows inside them. */
const LINE_LEAD_MS = 500;
/** The least a line holds after its action, so the result is seen while the words finish. */
const LINE_TAIL_MS = 700;

/** How long a keycap stays up for a press nobody narrates: long enough to read. */
const KEYCAP_MS = 900;

/**
 * Show a key on the demo's keycap, or hide it with null. Decoration only: never throws.
 * @param tab - The tab.
 * @param label - The key as read ("↓", "Esc", "S"), or null to hide it.
 */
async function demoKeycap(tab: Tab, label: string | null): Promise<void> {
  if (tab.purpose !== 'demo' || !tab.page) {
    return;
  }
  await tab.page.evaluate(l => (window as unknown as { __vocionDemo?: { keycap: (l: string | null) => void } }).__vocionDemo?.keycap(l), label).catch(() => {});
}

/**
 * The box a key press moved: the focused element, else the selected row. Null when neither.
 * @param tab - The tab.
 */
async function demoFocusRect(tab: Tab): Promise<Rect | null> {
  if (!tab.page) {
    return null;
  }
  return tab.page.evaluate(() => (window as unknown as { __vocionDemo?: { focusRect: () => Rect | null } }).__vocionDemo?.focusRect() ?? null).catch(() => null);
}

const short = (e: unknown, n = 240) => String((e as Error)?.message ?? e ?? '').split('\n')[0]!.slice(0, n);

/**
 * The session a tool call belongs to: its run, else its conversation. Null outside both.
 * @param ctx - The tool's runtime context.
 * @param ctx.orgId - The workspace.
 * @param ctx.missionRunId - The run.
 * @param ctx.conversationId - The conversation.
 */
export function browserSessionKey(ctx: { orgId: string; missionRunId?: number | null; conversationId?: number | null }): string | null {
  if (ctx.missionRunId) {
    return `${ctx.orgId}:run:${ctx.missionRunId}`;
  }
  return ctx.conversationId ? `${ctx.orgId}:conv:${ctx.conversationId}` : null;
}

/** An answer every browser tool gives: the id of what it logged, and the page as it now stands. */
export type BrowserAnswer = {
  ok: boolean;
  /** The id this call logged on the session — cite it as evidence. */
  id: string | null;
  /** Why it did not do what was asked, when it did not. Opens "Refused" when nothing was done. */
  refused?: string;
  /** What happened, in one line ("disabled", "clicked", "typed"). */
  result?: string;
  url?: string;
  title?: string;
  /** The snapshot's own id, when the answer carries one. */
  snapshotId?: string;
  snapshot?: string;
  /** The request's acceptance lines, numbered — on the first open. */
  acceptance?: Array<{ requestId: number; lines: AcceptanceLine[] }>;
};

function touch(s: Session): void {
  s.lastUsed = Date.now();
  if (s.idle) {
    clearTimeout(s.idle);
  }
  // Idle: the tabs close, and what they recorded is FILED THEN (2026-10-05,
  // FE-226 re-recorded from chat: the demo sat in memory for the session's
  // three-hour life, and a deploy would have lost it). A mission run still
  // files at its end; a chat has no end, so idle is its end.
  const recordingDemo = [...s.tabs.values()].some(t => t.purpose === 'demo');
  s.idle = setTimeout(() => void closeTabs(s).then(() => flushRecordings(s)), recordingDemo ? BROWSER_LIMITS.demoIdleMs : BROWSER_LIMITS.idleMs);
  s.idle.unref?.();
}

/**
 * File the recordings set aside so far and forget them, so a session that
 * lives on files each stretch once.
 * @param s - The session.
 */
async function flushRecordings(s: Session): Promise<void> {
  if (s.recordings.length === 0) {
    return;
  }
  const batch = s.recordings.splice(0);
  await s.deps.keepRecordings(s.orgId, s.releaseId, batch, s.deps.now()).catch(async (err) => {
    const { logger } = await import('@/libs/Logger');
    logger.warn('live check recordings not kept', { orgId: s.orgId, releaseId: s.releaseId, error: short(err) });
  });
}

/**
 * What QA did while one video ran, as moments from its start: each action,
 * page read and screenshot, and any response that failed. Captures of another
 * viewport are left out.
 * @param evidence - The session's captures.
 * @param viewport - The video's viewport.
 * @param startedAt - When the video started.
 * @param endedAt - When it ended.
 */
export function timelineOf(evidence: readonly BrowserEvidence[], viewport: BrowserViewport, startedAt: string, endedAt: string): TimelineMoment[] {
  const t0 = Date.parse(startedAt);
  const t1 = Date.parse(endedAt);
  const out: TimelineMoment[] = [];
  for (const e of evidence) {
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at < t0 || at > t1) {
      continue;
    }
    const atMs = at - t0;
    if (e.kind === 'action') {
      out.push({ atMs, what: e.what, ok: e.ok, detail: e.detail, url: e.url, evidenceId: e.id });
    } else if (e.kind === 'snapshot' && e.viewport === viewport) {
      out.push({ atMs, what: `read the page "${e.title}"`, url: e.url, evidenceId: e.id });
    } else if (e.kind === 'screenshot' && e.viewport === viewport) {
      out.push({ atMs, what: `took a screenshot: ${e.caption}`, url: e.pageUrl, evidenceId: e.id });
    } else if (e.kind === 'response' && e.status >= 400) {
      out.push({ atMs, what: `${e.method} answered ${e.status}`, ok: false, url: e.url, evidenceId: e.id });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * What QA said while one tab's video ran, as the narration's script: each line at its moment from
 * the video's start, in order. Lines said in another tab, or outside the video's span, are not its.
 * @param evidence - The session's captures.
 * @param tabKey - The tab whose video it is.
 * @param startedAt - When the video started.
 * @param endedAt - When it ended.
 */
export function scriptOf(evidence: readonly BrowserEvidence[], tabKey: string, startedAt: string, endedAt: string): Array<{ atMs: number; text: string }> {
  const t0 = Date.parse(startedAt);
  const t1 = Date.parse(endedAt);
  return evidence
    .filter((e): e is Extract<BrowserEvidence, { kind: 'said' }> => e.kind === 'said' && e.tab === tabKey)
    .map(e => ({ atMs: Date.parse(e.at) - t0, text: e.text, at: Date.parse(e.at) }))
    .filter(l => Number.isFinite(l.atMs) && l.atMs >= 0 && l.at <= t1)
    .sort((a, b) => a.atMs - b.atMs)
    .map(({ atMs, text }) => ({ atMs, text }));
}

/**
 * Say a line to the viewer at this moment: logged as evidence, and in a demo tab the screen is
 * held for as long as the line takes to say, so the state it describes stays in view.
 * @param s - The session.
 * @param tab - The tab the line belongs to.
 * @param d - The clock and the hold.
 * @param text - The line, or nothing.
 * @param focus - The box the line is about, lit while it is spoken.
 */
async function sayLine(s: Session, tab: Tab, d: LiveBrowserDeps, text: string | undefined, focus: Rect | null = null): Promise<string | null> {
  const line = text?.trim().slice(0, 300);
  if (!line) {
    return null;
  }
  const entry = log(s, 'said', { text: line, tab: tab.key }, d.now());
  if (tab.purpose === 'demo') {
    await demoSpotlight(tab, focus);
    await d.dwell(spokenMs(line));
    await demoSpotlight(tab, null);
  }
  return entry.id;
}

async function closeTabs(s: Session): Promise<void> {
  const tabs = [...s.tabs.values()];
  s.tabs.clear();
  s.current = null;
  for (const t of tabs) {
    await t.context.close().catch(() => {});
    // A page's video is written when its context closes; only the pages QA drove are set aside.
    for (const v of t.videos) {
      const file = await v.video.path().catch(() => null);
      if (file) {
        const endedAt = s.deps.now().toISOString();
        const evidence = [...s.evidence.values()];
        s.recordings.push({ path: file, viewport: t.viewport, signedIn: t.signedIn, env: t.env.slug, startedAt: v.startedAt, endedAt, timeline: timelineOf(evidence, t.viewport, v.startedAt, endedAt), purpose: t.purpose, requestId: t.requestId, script: t.purpose === 'demo' ? scriptOf(evidence, t.key, v.startedAt, endedAt) : [] });
      }
    }
  }
}

function sweep(): void {
  const cutoff = Date.now() - BROWSER_LIMITS.ttlMs;
  for (const [key, s] of sessions) {
    if (s.lastUsed < cutoff) {
      void closeBrowserSession(key);
    }
  }
}

type EvidenceOf<K extends BrowserEvidence['kind']> = Extract<BrowserEvidence, { kind: K }>;

function log<K extends BrowserEvidence['kind']>(s: Session, kind: K, e: Omit<EvidenceOf<K>, 'id' | 'kind' | 'at'>, now: Date, id?: string): EvidenceOf<K> {
  s.seq += 1;
  const entry = { id: id ?? `${kind === 'snapshot' ? 'snap' : kind === 'response' ? 'resp' : 'act'}-${s.seq}`, kind, at: now.toISOString(), ...e } as unknown as EvidenceOf<K>;
  s.evidence.set(entry.id, entry);
  return entry;
}

function allowed(s: Session, url: string): boolean {
  try {
    return s.origins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

function refuse(why: string, id: string | null = null): BrowserAnswer {
  return { ok: false, id, refused: `Refused: ${why}` };
}

/**
 * The page's accessibility snapshot, with refs, as QA reads it: the address, the title and the
 * tree, capped. Playwright's own snapshot for an AI (`_snapshotForAI`, what Playwright MCP serves):
 * each element carries its role, name, state (`[disabled]`, `[checked]`, `[expanded]`) and a ref.
 * @param page - The page.
 * @param find
 */
async function ariaSnapshot(page: Page, find?: string | null): Promise<{ url: string; title: string; text: string }> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const p = page as Page & { _snapshotForAI?: (o?: { timeout?: number }) => Promise<{ full: string } | string> };
  let tree: string;
  if (typeof p._snapshotForAI === 'function') {
    const snap = await p._snapshotForAI({ timeout: 10_000 });
    tree = typeof snap === 'string' ? snap : snap.full;
  } else {
    // A Playwright without the AI snapshot: the plain aria snapshot, without refs.
    tree = `${await page.locator('body').ariaSnapshot({ timeout: 10_000 })}\n[this browser gives no refs: act on nothing, read only]`;
  }
  const head = `URL: ${url}\nTitle: ${title}\n`;
  // A page longer than the cap shows its top, or the part around the words asked for (`snapshotWindow`).
  const { text } = snapshotWindow(tree, BROWSER_LIMITS.snapshotChars - head.length, find);
  return { url, title, text: head + text };
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
}

/**
 * Answer with the page as it now stands, logging the snapshot.
 * @param s - The session.
 * @param tab - The tab.
 * @param d - The clock.
 * @param base - What the call did.
 * @param find - Words on the part of a long page to show, else its top.
 */
async function withSnapshot(s: Session, tab: Tab, d: LiveBrowserDeps, base: BrowserAnswer, find?: string | null): Promise<BrowserAnswer> {
  const page = tab.page!;
  try {
    const snap = await ariaSnapshot(page, find);
    const entry = log(s, 'snapshot', { url: snap.url, title: snap.title, viewport: tab.viewport, signedIn: tab.signedIn }, d.now());
    const blocked = s.blocked.splice(0);
    const note = blocked.length > 0 ? ` The page tried to open ${blocked.slice(0, 3).join(', ')}, which is not one of the product's own addresses; it was not opened.` : '';
    return { ...base, ...(note ? { result: `${base.result ?? ''}${note}`.trim() } : {}), url: snap.url, title: snap.title, snapshotId: entry.id, snapshot: snap.text };
  } catch (e) {
    return { ...base, url: page.url(), result: `${base.result ?? ''} (the snapshot could not be read: ${short(e)})`.trim() };
  }
}

function active(key: string | null): { s: Session; tab: Tab } | BrowserAnswer {
  const s = key ? sessions.get(key) : undefined;
  if (!s) {
    return refuse('no page is open in this run: call browser_open with the release and a path first.');
  }
  const tab = s.current ? s.tabs.get(s.current) : undefined;
  if (!tab?.page || tab.page.isClosed()) {
    return refuse('no page is open in this run (it closed after being idle): call browser_open again.');
  }
  if (s.actions >= BROWSER_LIMITS.actions) {
    return refuse(`this run's browser has done its ${BROWSER_LIMITS.actions} actions; record what you saw with record_live_check.`);
  }
  s.actions += 1;
  touch(s);
  return { s, tab };
}

/**
 * Open (or reuse) this run's browser on one of the release product's own addresses, signed in as
 * its QA account unless asked not to, and answer with the page's snapshot.
 * @param key - The session (`browserSessionKey`).
 * @param orgId - The workspace.
 * @param input - What to open.
 * @param input.releaseId - The release being checked.
 * @param input.target - A path on the product (`/documents`) or a full address on one of its origins.
 * @param input.signedIn - As the product's QA account (default) or a visitor with no session.
 * @param input.viewport - desktop (default) or phone.
 * @param input.demoForRequest - Open (or return to) the demo tab of this shipped request: its own
 *   recording, filed on that request as its feature demo.
 * @param input.say - What QA tells the viewer as the page opens.
 * @param deps - The browser and the clock.
 */
export async function browserOpen(key: string | null, orgId: string, input: { releaseId: number; target: string; signedIn?: boolean; viewport?: BrowserViewport; demoForRequest?: number; say?: string }, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  if (!key) {
    return refuse('the browser runs inside a run or a conversation, and this call has neither.');
  }
  sweep();
  let s = sessions.get(key);
  let acceptance: BrowserAnswer['acceptance'];
  if (s && s.releaseId !== input.releaseId) {
    return refuse(`this run's browser is checking release #${s.releaseId}; one run checks one release.`);
  }
  if (!s) {
    const release = await releaseLines(orgId, input.releaseId);
    if (!release.ok) {
      return refuse(release.why);
    }
    const { productAccess } = await import('@/services/factory/productAccess');
    const access = await productAccess(orgId, release.product, { reveal: true });
    s = { key, orgId, releaseId: input.releaseId, product: release.product, requestIds: release.requestIds, envs: access.environments, origins: allowedOrigins(access.environments), tabs: new Map(), current: null, seq: 0, evidence: new Map(), responses: [], problems: [], blocked: [], actions: 0, lastUsed: Date.now(), idle: null, videoDir: d.videoDir(key), recordings: [], deps: d };
    sessions.set(key, s);
    acceptance = release.acceptance;
    if (s.envs.length === 0) {
      s.problems.push({ kind: 'could_not_run', detail: `no production environment is recorded for ${release.product}; an environment record names its product, stage, url and QA sign-in` });
    }
  }
  if (s.actions >= BROWSER_LIMITS.actions) {
    return refuse(`this run's browser has done its ${BROWSER_LIMITS.actions} actions; record what you saw with record_live_check.`);
  }
  s.actions += 1;
  touch(s);
  const signedIn = input.signedIn !== false;
  const viewport: BrowserViewport = input.viewport === 'phone' ? 'phone' : 'desktop';
  const demoFor = input.demoForRequest ?? null;
  const fail = (why: string, problem?: LiveReason): BrowserAnswer => {
    if (problem) {
      s.problems.push(problem);
    }
    const entry = log(s, 'action', { what: `open ${input.target}`, ok: false, detail: why, url: null }, d.now());
    return { ...refuse(why, entry.id), ...(acceptance ? { acceptance } : {}) };
  };
  if (s.envs.length === 0) {
    return fail(s.problems[0]?.detail ?? `no production environment is recorded for ${s.product}`);
  }
  if (demoFor !== null && !s.requestIds.includes(demoFor)) {
    return fail(`request #${demoFor} is not one this release shipped (${s.requestIds.map(id => `#${id}`).join(', ') || 'none'}), so there is no feature of it to demo`);
  }
  // WHERE: a path opens on the environment that carries the QA sign-in; an address must be one of the product's own.
  let target: string;
  let env: EnvironmentAccess | null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input.target)) {
    if (!allowed(s, input.target)) {
      return fail(`${input.target.slice(0, 200)} is not one of the product's own addresses (${[...s.origins].join(', ')})`);
    }
    target = input.target;
    const origin = new URL(target).origin;
    env = s.envs.find(e => e.url && new URL(e.url).origin === origin) ?? environmentFor({}, s.envs);
  } else {
    env = environmentFor({}, s.envs);
    if (!env?.url) {
      return fail(`no environment of ${s.product} has an address`);
    }
    target = `${String(env.url).replace(/\/+$/, '')}/${input.target.replace(/^\/+/, '')}`;
  }
  if (!env) {
    return fail(`no environment of ${s.product} has an address`);
  }
  // A demo is its own tab (so its own video), one per request and viewport.
  const tabKey = `${demoFor !== null ? `demo:${demoFor}|` : ''}${env.slug}|${viewport}|${signedIn ? 'in' : 'out'}`;
  let tab = s.tabs.get(tabKey);
  if (!tab) {
    if (s.tabs.size >= BROWSER_LIMITS.contexts) {
      return fail(`this run's browser has ${BROWSER_LIMITS.contexts} sessions open, the most it keeps`);
    }
    let browser: Browser;
    try {
      browser = await d.browser();
    } catch (e) {
      return fail(`the live check could not start a browser on this installation: ${short(e)}`, { kind: 'could_not_run', detail: `the live check could not start a browser on this installation: ${short(e)}` });
    }
    // Recorded at the viewport's own size, so a phone check plays as a phone.
    // A RECORDING NEVER COSTS THE CHECK (2026-10-03, FE-419): recording needs a
    // video encoder this installation may not have ("Executable doesn't exist
    // at …/ffmpeg-linux" failed every page). The first page is opened here; when
    // that fails with recording on, the check runs without it and says so once.
    if (recordingBroken) {
      s.videoDir = null;
    }
    let context = await browser.newContext({ ...BROWSER_VIEWPORTS[viewport], ...(s.videoDir ? { recordVideo: { dir: s.videoDir, size: BROWSER_VIEWPORTS[viewport].viewport } } : {}) });
    let primed: Page | null = null;
    if (s.videoDir) {
      try {
        primed = await context.newPage();
      } catch (e) {
        recordingBroken = short(e);
        console.warn('live check: recording is not available here; checking without it', { reason: recordingBroken });
        await context.close().catch(() => {});
        s.videoDir = null;
        context = await browser.newContext({ ...BROWSER_VIEWPORTS[viewport] });
      }
    }
    const session = s;
    // The page goes only where the product lives: a top-level navigation elsewhere is answered
    // 204 (the browser stays on the page it was on) and said on the next answer.
    await context.route('**/*', (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame().parentFrame() === null && !allowed(session, req.url())) {
        session.blocked.push(req.url().slice(0, 200));
        return route.fulfill({ status: 204, body: '' });
      }
      return route.continue();
    });
    context.on('page', p => p.on('dialog', dlg => void dlg.accept().catch(() => {})));
    if (demoFor !== null) {
      await context.addInitScript(DEMO_CHROME_SCRIPT).catch(() => {});
    }
    context.on('response', (r) => {
      const type = r.request().resourceType();
      if (type !== 'fetch' && type !== 'xhr' && type !== 'document') {
        return;
      }
      const entry = log(session, 'response', { method: r.request().method(), url: r.url().slice(0, 500), status: r.status(), signedIn }, d.now());
      session.responses.push(entry.id);
      if (session.responses.length > BROWSER_LIMITS.responses) {
        session.evidence.delete(session.responses.shift()!);
      }
    });
    tab = { key: tabKey, env, viewport, signedIn, purpose: demoFor !== null ? 'demo' : 'check', requestId: demoFor, context, page: primed, videos: primed?.video() ? [{ video: primed.video()!, startedAt: d.now().toISOString() }] : [], openedAt: d.now().toISOString() };
    if (signedIn) {
      const problem = signInProblem(env) || await signIn(context, env);
      if (problem) {
        await context.close().catch(() => {});
        return fail(`signing in to ${env.slug} as the QA account failed: ${problem}`, { kind: 'sign_in_failed', detail: `signing in to ${env.slug} as the QA account failed: ${problem}` });
      }
    }
    s.tabs.set(tabKey, tab);
  }
  if (signedIn) {
    s.problems = s.problems.filter(p => p.kind !== 'sign_in_failed');
  }
  s.current = tabKey;
  if (!tab.page || tab.page.isClosed()) {
    tab.page = await tab.context.newPage();
    const video = tab.page.video();
    if (video) {
      tab.videos.push({ video, startedAt: d.now().toISOString() });
    }
  }
  let status: number | null = null;
  let clicked = false;
  try {
    // A PERSON CLICKS, A SCRIPT TELEPORTS (Chris, 2026-10-05): in a demo, when a link to the
    // page is on screen, the cursor goes to it and clicks; the address is typed only when
    // nothing on screen leads there.
    const via = tab.purpose === 'demo' && tab.page.url().startsWith('http') ? await linkOnScreen(tab, target) : null;
    if (via) {
      await demoPointAt(tab, await via.boundingBox({ timeout: 2000 }).catch(() => null));
      await via.click({ timeout: BROWSER_LIMITS.actMs });
      await tab.page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      clicked = true;
    } else {
      const res = await tab.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      status = res?.status() ?? null;
    }
    await settle(tab.page);
    if (tab.purpose === 'demo') {
      await d.dwell(HUMAN_BEATS.afterNavigationMs);
    }
  } catch (e) {
    const blocked = s.blocked.splice(0);
    return fail(blocked.length > 0 ? `${blocked[0]} is not one of the product's own addresses; it was not opened` : `the page did not open: ${short(e)}`);
  }
  const entry = log(s, 'action', { what: `open ${input.target.slice(0, 200)}${signedIn ? '' : ' as a visitor'} (${viewport}${demoFor !== null ? `, demo of #${demoFor}` : ''})${clicked ? ', by its link' : ''}`, ok: true, detail: status ? `HTTP ${status}` : clicked ? 'clicked the link on screen' : null, url: tab.page.url() }, d.now());
  await sayLine(s, tab, d, input.say);
  return withSnapshot(s, tab, d, { ok: true, id: entry.id, result: `opened${status ? ` (HTTP ${status})` : ''}`, ...(acceptance ? { acceptance } : {}) });
}

/**
 * The open page's snapshot, logged. With `find`, a long page is shown around
 * the first element carrying those words rather than from its top (walk 22,
 * FE-226: the Expiry section fell past the cap and could not be reached).
 * @param key - The session.
 * @param deps - The clock.
 * @param input - `find`: words on the section wanted.
 * @param input.find - Words on the section wanted, case-insensitive.
 */
export async function browserSnapshot(key: string | null, deps: Partial<LiveBrowserDeps> = {}, input: { find?: string | null } = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  const a = active(key);
  if (!('s' in a)) {
    return a;
  }
  const out = await withSnapshot(a.s, a.tab, d, { ok: true, id: null }, input.find ?? null);
  return { ...out, id: out.snapshotId ?? null };
}

/**
 * A ref from the last snapshot, as a locator, or why it cannot be one.
 * @param page - The page.
 * @param ref - The ref (`e5`).
 */
function byRef(page: Page, ref: string) {
  const r = ref.trim().replace(/^\[?ref=/, '').replace(/\]$/, '');
  return /^[a-z]?\d+$|^f\d+e\d+$/i.test(r) ? page.locator(`aria-ref=${r}`) : null;
}

function act(key: string | null, d: LiveBrowserDeps, what: string, ref: string | null, run: (page: Page, tab: Tab) => Promise<{ ok: boolean; result: string }>, say?: string, keyName?: string): Promise<BrowserAnswer> {
  return inOrder(key, () => actNow(key, d, what, ref, run, say, keyName));
}

async function actNow(key: string | null, d: LiveBrowserDeps, what: string, ref: string | null, run: (page: Page, tab: Tab) => Promise<{ ok: boolean; result: string }>, say?: string, keyName?: string): Promise<BrowserAnswer> {
  const a = active(key);
  if (!('s' in a)) {
    return a;
  }
  const { s, tab } = a;
  const page = tab.page!;
  // SAID WHILE IT IS DONE (Chris, 2026-10-05: "the highlight focus sections don't quite line up
  // with the timing of the voiceover"). In a demo a step with a line starts the line first, with
  // its target outlined; the cursor glides and the action lands inside the words, the outline
  // follows to the result, and the screen holds only for what is left of the line. Doing first and
  // saying after put every change a second ahead of its words, with silence between lines.
  const line = tab.purpose === 'demo' ? say?.trim().slice(0, 300) || null : null;
  const lineStart = d.now().getTime();
  // Where a person would look first: the element scrolled into view.
  let target: Rect | null = null;
  if (tab.purpose === 'demo' && ref) {
    await byRef(page, ref)?.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    target = await byRef(page, ref)?.boundingBox({ timeout: 2000 }).catch(() => null) ?? null;
  }
  const said = line ? log(s, 'said', { text: line, tab: tab.key }, d.now()) : null;
  if (line) {
    await demoSpotlight(tab, target);
    await d.dwell(LINE_LEAD_MS);
  }
  // The cursor glides to the target and ripples as the action lands.
  if (tab.purpose === 'demo' && ref) {
    await demoPointAt(tab, target);
  }
  // A key press has no target to point at: the key itself is shown, as a keycap, as it lands.
  const demoKey = tab.purpose === 'demo' && keyName ? keycapLabel(keyName) : null;
  if (demoKey) {
    await demoKeycap(tab, demoKey);
  }
  let out: { ok: boolean; result: string };
  try {
    out = await run(page, tab);
  } catch (e) {
    out = { ok: false, result: `${ref ? `ref ${ref} could not be used (if the page changed, take a new snapshot): ` : ''}${short(e)}` };
  }
  if (out.ok) {
    await settle(page);
    if (tab.purpose === 'demo' && !line) {
      await d.dwell(HUMAN_BEATS.afterActionMs);
    }
  }
  const entry = log(s, 'action', { what, ok: out.ok, detail: out.result, url: page.url() }, d.now());
  if (said && !out.ok) {
    // A line for a step that did not happen is not said: it leaves the demo's script.
    s.evidence.delete(said.id);
    await demoSpotlight(tab, null);
  }
  if (out.ok) {
    // The area spoken about: the target as it stands after the action (it may have moved or changed).
    // A press is about whatever it moved: the element with focus, or the row now selected.
    const focus = tab.purpose === 'demo'
      ? ref ? await byRef(page, ref)?.boundingBox({ timeout: 1000 }).catch(() => null) ?? target : demoKey ? await demoFocusRect(tab) : null
      : null;
    if (line) {
      await demoSpotlight(tab, focus);
      await d.dwell(Math.max(LINE_TAIL_MS, spokenMs(line) - (d.now().getTime() - lineStart)));
      await demoSpotlight(tab, null);
    } else {
      if (demoKey) {
        await d.dwell(KEYCAP_MS);
      }
      await sayLine(s, tab, d, say, focus);
    }
  }
  if (demoKey) {
    await demoKeycap(tab, null);
  }
  return withSnapshot(s, tab, d, { ok: out.ok, id: entry.id, result: out.result });
}

/**
 * Click an element by its ref. A disabled one is reported as disabled at once, and not clicked.
 * @param key - The session.
 * @param ref - The ref from the last snapshot.
 * @param deps - The clock.
 * @param say - What QA tells the viewer once it is clicked.
 */
export async function browserClick(key: string | null, ref: string, deps: Partial<LiveBrowserDeps> = {}, say?: string): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  return act(key, d, `click ${ref}`, ref, async (page) => {
    const loc = byRef(page, ref);
    if (!loc) {
      return { ok: false, result: `"${ref}" is not a ref: use one from the snapshot, like e5` };
    }
    if (!(await loc.isEnabled({ timeout: 2000 }))) {
      return { ok: false, result: 'disabled: the element is disabled, so it was not clicked' };
    }
    await loc.click({ timeout: BROWSER_LIMITS.actMs });
    return { ok: true, result: 'clicked' };
  }, say);
}

/**
 * Type into an element by its ref, replacing what it held; `submit` presses Enter after.
 * @param key - The session.
 * @param input - What to type where.
 * @param input.ref - The ref from the last snapshot.
 * @param input.text - The text.
 * @param input.submit - Press Enter after.
 * @param input.say - What QA tells the viewer once it is typed.
 * @param deps - The clock.
 */
export async function browserType(key: string | null, input: { ref: string; text: string; submit?: boolean; say?: string }, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  return act(key, d, `type into ${input.ref}${input.submit ? ' and submit' : ''}`, input.ref, async (page, tab) => {
    const loc = byRef(page, input.ref);
    if (!loc) {
      return { ok: false, result: `"${input.ref}" is not a ref: use one from the snapshot, like e5` };
    }
    if (!(await loc.isEditable({ timeout: 2000 }))) {
      return { ok: false, result: 'not editable: the element is disabled or read-only, so nothing was typed' };
    }
    if (tab.purpose === 'demo') {
      // A person clicks into the field and types; a script pastes.
      await loc.click({ timeout: BROWSER_LIMITS.actMs });
      await loc.fill('', { timeout: BROWSER_LIMITS.actMs });
      await loc.pressSequentially(input.text, { delay: HUMAN_BEATS.keystrokeMs, timeout: BROWSER_LIMITS.actMs + input.text.length * HUMAN_BEATS.keystrokeMs });
    } else {
      await loc.fill(input.text, { timeout: BROWSER_LIMITS.actMs });
    }
    if (input.submit) {
      await loc.press('Enter', { timeout: BROWSER_LIMITS.actMs });
    }
    return { ok: true, result: input.submit ? 'typed and submitted' : 'typed' };
  }, input.say);
}

/**
 * Put a file into the page: a generated sample PDF of about `megabytes`, named
 * `name`. The ref is a file input, or a control that opens the file chooser (an
 * Upload button, a drop zone's button). Chris, 2026-10-04: the expiry demo
 * "doesn't quite show it all happening. Like there's no pdf upload" — a demo
 * of a product that takes files has to put one in.
 * @param key - The session.
 * @param input - Where and what.
 * @param input.ref - The ref from the last snapshot: a file input, or what opens the chooser.
 * @param input.name - The file's name as the product sees it.
 * @param input.megabytes - About how big; 1 when unsaid, 64 at most.
 * @param input.say - What QA tells the viewer once the file is in.
 * @param deps - The clock.
 */
export async function browserUpload(key: string | null, input: { ref: string; name?: string; megabytes?: number; say?: string }, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  const mb = Math.min(64, Math.max(0.001, Number(input.megabytes) || 1));
  const name = (input.name?.trim() || `sample-${mb}mb.pdf`).replace(/[^\w.-]+/g, '-').slice(0, 120);
  return act(key, d, `upload ${name} via ${input.ref}`, input.ref, async (page) => {
    const loc = byRef(page, input.ref);
    if (!loc) {
      return { ok: false, result: `"${input.ref}" is not a ref: use one from the snapshot, like e5` };
    }
    const { samplePdf } = await import('@/libs/factory/samplePdf');
    const file = { name, mimeType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', buffer: samplePdf(Math.round(mb * 1024 * 1024)) };
    const isFileInput = await loc.evaluate(el => el instanceof HTMLInputElement && el.type === 'file').catch(() => false);
    if (isFileInput) {
      await loc.setInputFiles(file, { timeout: BROWSER_LIMITS.actMs });
      return { ok: true, result: `uploaded ${name} (${mb} MB)` };
    }
    // A button or a drop zone: it opens the chooser; the file goes in there.
    const chooser = page.waitForEvent('filechooser', { timeout: BROWSER_LIMITS.actMs });
    await loc.click({ timeout: BROWSER_LIMITS.actMs });
    try {
      await (await chooser).setFiles(file);
    } catch (e) {
      return { ok: false, result: `${input.ref} opened no file chooser (${short(e)}); use the file input's own ref, or a control that opens one` };
    }
    return { ok: true, result: `uploaded ${name} (${mb} MB) through the chooser` };
  }, input.say);
}

/**
 * Press a key on the page (Enter, Escape, Tab, ArrowDown…).
 * @param key - The session.
 * @param keyName - The key, in Playwright's names.
 * @param deps - The clock.
 * @param say - What QA tells the viewer once it is pressed.
 */
export async function browserPress(key: string | null, keyName: string, deps: Partial<LiveBrowserDeps> = {}, say?: string): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  return act(key, d, `press ${keyName}`, null, async (page) => {
    await page.keyboard.press(keyName);
    return { ok: true, result: `pressed ${keyName}` };
  }, say, keyName);
}

/**
 * Say a line to the viewer with nothing done on the page: the demo's opening and closing words, or
 * a sentence about what is already on screen. In a demo tab the screen holds while it is said.
 * @param key - The session.
 * @param text - The line.
 * @param deps - The clock and the hold.
 * @param ref
 */
export function browserSay(key: string | null, text: string, deps: Partial<LiveBrowserDeps> = {}, ref?: string | null): Promise<BrowserAnswer> {
  return inOrder(key, () => sayNow(key, text, deps, ref ?? null));
}

async function sayNow(key: string | null, text: string, deps: Partial<LiveBrowserDeps>, ref: string | null = null): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  const a = active(key);
  if (!('s' in a)) {
    return a;
  }
  const line = text.trim();
  if (!line) {
    return refuse('nothing to say: give the line in a person\'s words.');
  }
  // WHERE TO LOOK WHILE IT IS SAID (Chris, 2026-10-05: "there's a lot on the screen and I have
  // no idea what the narrator wants me looking at"): a line about something on screen names its
  // ref; the page scrolls to it, the cursor rests on it (no click) and it is outlined while said.
  let focus: Rect | null = null;
  if (ref && a.tab.purpose === 'demo' && a.tab.page) {
    const loc = byRef(a.tab.page, ref);
    await loc?.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    focus = await loc?.boundingBox({ timeout: 2000 }).catch(() => null) ?? null;
    await demoPointAt(a.tab, focus, { ripple: false });
  }
  const id = await sayLine(a.s, a.tab, d, line, focus);
  return { ok: true, id, result: a.tab.purpose === 'demo' ? `said, and held the screen ${Math.round(spokenMs(line) / 100) / 10}s` : 'said (no demo tab is open, so the screen was not held)', url: a.tab.page!.url() };
}

/**
 * A screenshot of the open page, stored and filed on the release as a live shot, its caption
 * saying what it shows. Its id is `shot-<artifact id>`.
 * @param key - The session.
 * @param caption - What the picture shows.
 * @param who - Who it is recorded as.
 * @param who.author - The agent.
 * @param who.provenance - The run it was taken in.
 * @param who.provenance.agentSlug - The seat.
 * @param who.provenance.missionRunId - The run.
 * @param deps - The store and the clock.
 */
export async function browserScreenshot(key: string | null, caption: string, who: { author: Author; provenance?: { agentSlug?: string | null; missionRunId?: number | null } }, deps: Partial<LiveBrowserDeps> = {}): Promise<{ ok: boolean; id: string | null; url?: string; refused?: string }> {
  const d = { ...defaultDeps, ...deps };
  const a = active(key);
  if (!('s' in a)) {
    return { ok: false, id: null, refused: a.refused };
  }
  const { s, tab } = a;
  const page = tab.page!;
  try {
    const png = await page.screenshot({ type: 'png', timeout: 15_000 });
    const stored = await d.store(s.orgId, png);
    const pageUrl = page.url();
    const { createArtifact } = await import('@/services/ArtifactService');
    const text = caption.trim().slice(0, 300) || 'Live page';
    const { artifact } = await createArtifact({
      orgId: s.orgId,
      conversationId: null,
      kind: 'file',
      title: `${text} · ${tab.viewport} · live`.slice(0, 120),
      spec: {
        filename: stored.filename,
        contentType: stored.contentType,
        bytes: stored.bytes,
        url: stored.url,
        caption: text,
        capturedFrom: pageUrl.slice(0, 2000),
        provenance: { by: who.author.id ?? null, releaseId: s.releaseId, liveCheck: true, viewport: tab.viewport, signedIn: tab.signedIn, agentSlug: who.provenance?.agentSlug ?? null, missionRunId: who.provenance?.missionRunId ?? null },
      },
      url: null,
      record: { type: 'object', id: String(s.releaseId), role: LIVE_ROLE },
      author: who.author,
      changeSummary: `Live check of release #${s.releaseId}: ${text}`.slice(0, 200),
      visibility: 'user',
    });
    const entry = log(s, 'screenshot', { artifactId: artifact.id, url: stored.url, pageUrl, caption: text, viewport: tab.viewport, signedIn: tab.signedIn }, d.now(), `shot-${artifact.id}`);
    return { ok: true, id: entry.id, url: stored.url };
  } catch (e) {
    const entry = log(s, 'action', { what: 'screenshot', ok: false, detail: short(e), url: page.url() }, d.now());
    return { ok: false, id: entry.id, refused: `Refused: the screenshot could not be stored: ${short(e)}` };
  }
}

/**
 * The responses the pages received this session (the page's own requests and its API calls), newest
 * last, each with its id.
 * @param key - The session.
 * @param pathContains - Only those whose address contains this.
 */
export function browserResponses(key: string | null, pathContains?: string): { ok: boolean; responses: Array<{ id: string; method: string; url: string; status: number; signedIn: boolean }>; refused?: string } {
  const s = key ? sessions.get(key) : undefined;
  if (!s) {
    return { ok: false, responses: [], refused: 'Refused: no page is open in this run: call browser_open first.' };
  }
  touch(s);
  const all = s.responses.map(id => s.evidence.get(id)).filter((e): e is Extract<BrowserEvidence, { kind: 'response' }> => e?.kind === 'response');
  const want = pathContains?.trim();
  return { ok: true, responses: (want ? all.filter(r => r.url.includes(want)) : all).slice(-60).map(({ id, method, url, status, signedIn }) => ({ id, method, url, status, signedIn })) };
}

/**
 * What a session captured, for the recording: its evidence by id, and what stopped it looking.
 * @param key - The session.
 */
export function browserSessionEvidence(key: string | null): { releaseId: number | null; evidence: ReadonlyMap<string, BrowserEvidence>; problems: LiveReason[] } {
  const s = key ? sessions.get(key) : undefined;
  return { releaseId: s?.releaseId ?? null, evidence: s?.evidence ?? new Map(), problems: s ? [...s.problems] : [] };
}

/**
 * Close a session's browser, keep its recordings, and drop what it captured. The automation calls
 * this when its run's check has ended (after the recording pass). Keeping a recording never throws:
 * a failure is logged and said where the request is read.
 * @param key - The session.
 */
export async function closeBrowserSession(key: string | null): Promise<void> {
  const s = key ? sessions.get(key) : undefined;
  if (!s) {
    return;
  }
  sessions.delete(s.key);
  if (s.idle) {
    clearTimeout(s.idle);
  }
  await closeTabs(s);
  await flushRecordings(s);
  // The sign-in page's video and anything not kept go with the session.
  if (s.videoDir) {
    await rm(s.videoDir, { recursive: true, force: true }).catch(() => {});
  }
}
