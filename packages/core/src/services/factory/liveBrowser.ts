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
 */

import type { Buffer } from 'node:buffer';
import type { Browser, BrowserContext, Page, Video } from 'playwright';
import type { AcceptanceLine, LiveReason } from '@/libs/factory/liveCheck';
import type { TimelineMoment } from '@/services/artifacts/recordings';
import type { Author } from '@/services/ArtifactService';
import type { EnvironmentAccess } from '@/services/factory/productAccess';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { LIVE_ROLE } from '@/libs/factory/liveCheck';
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
    | { id: string; kind: 'action'; at: string; what: string; ok: boolean; detail: string | null; url: string | null };

type Tab = { key: string; env: EnvironmentAccess; viewport: BrowserViewport; signedIn: boolean; context: BrowserContext; page: Page | null; videos: Array<{ video: Video; startedAt: string }>; openedAt: string };

/**
 * A tab's recording, set aside when its context closed, kept when the session
 * closes — with what QA did while it ran (`timeline`, ms from the video's
 * start), so a narration is timed to the moments it describes.
 */
export type SessionRecording = { path: string; viewport: BrowserViewport; signedIn: boolean; env: string; startedAt: string; endedAt: string; timeline: TimelineMoment[] };

type Session = {
  key: string;
  orgId: string;
  releaseId: number;
  product: string;
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
};

const sessions = new Map<string, Session>();

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
  s.idle = setTimeout(() => void closeTabs(s), BROWSER_LIMITS.idleMs);
  s.idle.unref?.();
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
        s.recordings.push({ path: file, viewport: t.viewport, signedIn: t.signedIn, env: t.env.slug, startedAt: v.startedAt, endedAt, timeline: timelineOf([...s.evidence.values()], t.viewport, v.startedAt, endedAt) });
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
 */
async function ariaSnapshot(page: Page): Promise<{ url: string; title: string; text: string }> {
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
  const room = BROWSER_LIMITS.snapshotChars - head.length;
  const text = tree.length > room ? `${tree.slice(0, room)}\n[truncated: ${tree.length - room} more characters of the page were not shown]` : tree;
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
 */
async function withSnapshot(s: Session, tab: Tab, d: LiveBrowserDeps, base: BrowserAnswer): Promise<BrowserAnswer> {
  const page = tab.page!;
  try {
    const snap = await ariaSnapshot(page);
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
 * @param deps - The browser and the clock.
 */
export async function browserOpen(key: string | null, orgId: string, input: { releaseId: number; target: string; signedIn?: boolean; viewport?: BrowserViewport }, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
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
    s = { key, orgId, releaseId: input.releaseId, product: release.product, envs: access.environments, origins: allowedOrigins(access.environments), tabs: new Map(), current: null, seq: 0, evidence: new Map(), responses: [], problems: [], blocked: [], actions: 0, lastUsed: Date.now(), idle: null, videoDir: d.videoDir(key), recordings: [], deps: d };
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
  const tabKey = `${env.slug}|${viewport}|${signedIn ? 'in' : 'out'}`;
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
    tab = { key: tabKey, env, viewport, signedIn, context, page: primed, videos: primed?.video() ? [{ video: primed.video()!, startedAt: d.now().toISOString() }] : [], openedAt: d.now().toISOString() };
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
  try {
    const res = await tab.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    status = res?.status() ?? null;
    await settle(tab.page);
  } catch (e) {
    const blocked = s.blocked.splice(0);
    return fail(blocked.length > 0 ? `${blocked[0]} is not one of the product's own addresses; it was not opened` : `the page did not open: ${short(e)}`);
  }
  const entry = log(s, 'action', { what: `open ${input.target.slice(0, 200)}${signedIn ? '' : ' as a visitor'} (${viewport})`, ok: true, detail: status ? `HTTP ${status}` : null, url: tab.page.url() }, d.now());
  return withSnapshot(s, tab, d, { ok: true, id: entry.id, result: `opened${status ? ` (HTTP ${status})` : ''}`, ...(acceptance ? { acceptance } : {}) });
}

/**
 * The open page's snapshot, logged.
 * @param key - The session.
 * @param deps - The clock.
 */
export async function browserSnapshot(key: string | null, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  const a = active(key);
  if (!('s' in a)) {
    return a;
  }
  const out = await withSnapshot(a.s, a.tab, d, { ok: true, id: null });
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

async function act(key: string | null, d: LiveBrowserDeps, what: string, ref: string | null, run: (page: Page) => Promise<{ ok: boolean; result: string }>): Promise<BrowserAnswer> {
  const a = active(key);
  if (!('s' in a)) {
    return a;
  }
  const { s, tab } = a;
  const page = tab.page!;
  let out: { ok: boolean; result: string };
  try {
    out = await run(page);
  } catch (e) {
    out = { ok: false, result: `${ref ? `ref ${ref} could not be used (if the page changed, take a new snapshot): ` : ''}${short(e)}` };
  }
  if (out.ok) {
    await settle(page);
  }
  const entry = log(s, 'action', { what, ok: out.ok, detail: out.result, url: page.url() }, d.now());
  return withSnapshot(s, tab, d, { ok: out.ok, id: entry.id, result: out.result });
}

/**
 * Click an element by its ref. A disabled one is reported as disabled at once, and not clicked.
 * @param key - The session.
 * @param ref - The ref from the last snapshot.
 * @param deps - The clock.
 */
export async function browserClick(key: string | null, ref: string, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
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
  });
}

/**
 * Type into an element by its ref, replacing what it held; `submit` presses Enter after.
 * @param key - The session.
 * @param input - What to type where.
 * @param input.ref - The ref from the last snapshot.
 * @param input.text - The text.
 * @param input.submit - Press Enter after.
 * @param deps - The clock.
 */
export async function browserType(key: string | null, input: { ref: string; text: string; submit?: boolean }, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  return act(key, d, `type into ${input.ref}${input.submit ? ' and submit' : ''}`, input.ref, async (page) => {
    const loc = byRef(page, input.ref);
    if (!loc) {
      return { ok: false, result: `"${input.ref}" is not a ref: use one from the snapshot, like e5` };
    }
    if (!(await loc.isEditable({ timeout: 2000 }))) {
      return { ok: false, result: 'not editable: the element is disabled or read-only, so nothing was typed' };
    }
    await loc.fill(input.text, { timeout: BROWSER_LIMITS.actMs });
    if (input.submit) {
      await loc.press('Enter', { timeout: BROWSER_LIMITS.actMs });
    }
    return { ok: true, result: input.submit ? 'typed and submitted' : 'typed' };
  });
}

/**
 * Press a key on the page (Enter, Escape, Tab, ArrowDown…).
 * @param key - The session.
 * @param keyName - The key, in Playwright's names.
 * @param deps - The clock.
 */
export async function browserPress(key: string | null, keyName: string, deps: Partial<LiveBrowserDeps> = {}): Promise<BrowserAnswer> {
  const d = { ...defaultDeps, ...deps };
  return act(key, d, `press ${keyName}`, null, async (page) => {
    await page.keyboard.press(keyName);
    return { ok: true, result: `pressed ${keyName}` };
  });
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
  if (s.recordings.length > 0) {
    await s.deps.keepRecordings(s.orgId, s.releaseId, s.recordings, s.deps.now()).catch(async (err) => {
      const { logger } = await import('@/libs/Logger');
      logger.warn('live check recordings not kept', { orgId: s.orgId, releaseId: s.releaseId, error: short(err) });
    });
  }
  // The sign-in page's video and anything not kept go with the session.
  if (s.videoDir) {
    await rm(s.videoDir, { recursive: true, force: true }).catch(() => {});
  }
}
