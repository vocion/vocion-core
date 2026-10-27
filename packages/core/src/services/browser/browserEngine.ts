/**
 * A PERSON'S BROWSER: one per person, kept between their runs, so a second
 * task picks up where the first left off — still signed in, on the same page.
 * Runs in it go one at a time (`BrowserRunService` refuses a second live run).
 * A run of a routine is the exception: it gets a browser of its own
 * (`sessionKeyOf`), so a routine runs for many rows at once, each in its own
 * cookies and storage, and that browser closes when the run ends.
 *
 * What it gives a run:
 *   - the page as a model reads it (`pageSnapshot`: roles, names, states, refs);
 *   - actions by ref, each drawn on the page as a person would see it — the
 *     cursor glides to the target and ripples where it clicks, the field being
 *     typed into is outlined (`libs/media/demoChrome.ts`, the same chrome the
 *     factory's demos use), so the live picture shows what is happening;
 *   - the live picture itself: Chrome's screencast keeps the latest frame,
 *     which the pane reads (`latestFrame`) several times a second;
 *   - the element an action is about, so the engine — never the model — can
 *     hold a step that submits, sends, pays or deletes for the person.
 *
 * Where it may go: any public address. A request to a private, loopback or
 * link-local address (the box's own services, the cloud metadata address) is
 * aborted, whatever the page or the model asked, by the same check the fetch
 * tools use (`libs/net/publicUrl.ts`), on every request the page makes.
 * `VOCION_BROWSER_ALLOW_HOSTS` (comma-separated `host` or `host:port`) opens
 * named private hosts for a test or a demo. The practice site is answered
 * from memory and never reaches the network (`practiceSite.ts`).
 *
 * Lifetime: the browser closes `BROWSER_RUN_LIMITS.idleMs` after its last
 * run ended; nothing about it survives the process, which is why a run that
 * was live when the app restarted reads as failed (`BrowserRunService`).
 */

import type { Buffer } from 'node:buffer';
import type { Browser, BrowserContext, CDPSession, Locator, Page } from 'playwright';
import { Buffer as NodeBuffer } from 'node:buffer';
import process from 'node:process';
import { BROWSER_RUN_LIMITS } from '@/libs/browser/run';
import { CURSOR_GLIDE_MS, DEMO_CHROME_SCRIPT } from '@/libs/media/demoChrome';
import { resolvesPublicly } from '@/libs/net/publicUrl';
import { byRef, pageSnapshot } from './pageSnapshot';
import { practiceResponse } from './practiceSite';

const BROWSER_VIEWPORT = { width: 1280, height: 800 } as const;

export type BrowserSession = {
  key: string;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession | null;
  frame: Buffer | null;
  frameSeq: number;
  /** Where no screencast is offered, a picture taken this often instead. */
  poll: ReturnType<typeof setInterval> | null;
  /** Requests the guard stopped since the model last looked. */
  blocked: string[];
  idle: ReturnType<typeof setTimeout> | null;
  busy: boolean;
};

/** What a session needs from outside, so a test can stand in for Chrome. */
export type EngineDeps = { browser: () => Promise<Browser> };

const defaultDeps: EngineDeps = {
  // Its own browser, never the document renderer's: in a container of its own where there is one
  // (`browserHost.ts`).
  browser: async () => (await import('./browserHost')).browserHost(),
};

// On the process, not the module: a module evaluated again (a dev server's reload) still finds the
// browsers it opened, so a live run's picture and its answers reach the run that holds them.
const sessions: Map<string, BrowserSession> = ((globalThis as { __vocionBrowserSessions?: Map<string, BrowserSession> }).__vocionBrowserSessions ??= new Map());

// Which browser a run drives, and the live picture, are read without the engine (`liveFrames.ts`).
export { frameSeq, latestFrame, personKey, sessionKeyOf, whereNow } from './liveFrames';

function allowHosts(): Set<string> {
  return new Set((process.env.VOCION_BROWSER_ALLOW_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean));
}

const verdicts = new Map<string, { ok: boolean; at: number }>();

/**
 * Whether the browser may load this address: the practice site, a named
 * allowed host, or a host that resolves only to public addresses. Cached a
 * minute per host.
 * @param raw - The request's address.
 */
export async function mayLoad(raw: string): Promise<boolean> {
  if (/^(?:data|blob|about):/i.test(raw) || practiceResponse(raw)) {
    return true;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return false;
  }
  const allowed = allowHosts();
  if (allowed.has(u.host.toLowerCase()) || allowed.has(u.hostname.toLowerCase())) {
    return true;
  }
  const hit = verdicts.get(u.host);
  if (hit && Date.now() - hit.at < 60_000) {
    return hit.ok;
  }
  const v = await resolvesPublicly(raw).catch(() => ({ ok: false as const }));
  verdicts.set(u.host, { ok: v.ok, at: Date.now() });
  return v.ok;
}

async function startScreencast(s: BrowserSession): Promise<void> {
  try {
    await s.cdp?.detach().catch(() => {});
    const cdp = await s.context.newCDPSession(s.page);
    s.cdp = cdp;
    cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
      s.frame = NodeBuffer.from(f.data, 'base64');
      s.frameSeq += 1;
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: BROWSER_VIEWPORT.width, maxHeight: BROWSER_VIEWPORT.height, everyNthFrame: 1 });
  } catch {
    // No screencast (a browser that does not speak CDP to us): a picture twice a second instead.
    s.cdp = null;
    if (!s.poll) {
      s.poll = setInterval(() => {
        if (s.page.isClosed()) {
          return;
        }
        void s.page.screenshot({ type: 'jpeg', quality: 60 }).then((jpeg) => {
          s.frame = jpeg;
          s.frameSeq += 1;
        }).catch(() => {});
      }, 500);
      s.poll.unref?.();
    }
  }
}

/** A saved browser: its cookies and site storage, and where it was. */
export type SavedBrowser = { storageState: Awaited<ReturnType<BrowserContext['storageState']>>; url: string };

/**
 * The browser as it stands, to put it back after a restart: cookies, site storage, the page.
 * @param s - The browser.
 */
export async function saveBrowser(s: BrowserSession): Promise<SavedBrowser> {
  return { storageState: await s.context.storageState(), url: s.page.url() };
}

function touch(s: BrowserSession): void {
  if (s.idle) {
    clearTimeout(s.idle);
    s.idle = null;
  }
}

/**
 * The person's browser, opened if it is not.
 * @param key - `personKey(orgId, userId)`.
 * @param deps - Chrome.
 * @param restore
 */
export async function openBrowserSession(key: string, deps: Partial<EngineDeps> = {}, restore?: SavedBrowser | null): Promise<BrowserSession> {
  const existing = sessions.get(key);
  if (existing && !existing.page.isClosed()) {
    touch(existing);
    return existing;
  }
  const d = { ...defaultDeps, ...deps };
  const browser = await d.browser();
  const context = await browser.newContext({ viewport: BROWSER_VIEWPORT, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/Los_Angeles', acceptDownloads: false, ...(restore ? { storageState: restore.storageState } : {}) });
  await context.addInitScript(DEMO_CHROME_SCRIPT);
  const s: BrowserSession = { key, context, page: await context.newPage(), cdp: null, frame: null, frameSeq: 0, poll: null, blocked: [], idle: null, busy: false };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const practice = practiceResponse(url);
    if (practice) {
      return route.fulfill({ status: practice.status, contentType: practice.contentType, body: practice.body });
    }
    if (await mayLoad(url)) {
      return route.continue();
    }
    if (route.request().isNavigationRequest()) {
      s.blocked.push(url.slice(0, 200));
    }
    return route.abort('blockedbyclient');
  });
  // A page that opens a new tab: follow it, so the picture and the model see the same page.
  context.on('page', (p) => {
    if (p === s.page) {
      return;
    }
    s.page = p;
    void startScreencast(s);
  });
  sessions.set(key, s);
  await startScreencast(s);
  // Put back where it was: the page it was on, signed in as it was (`saveBrowser`).
  if (restore && /^https?:/.test(restore.url)) {
    await s.page.goto(restore.url, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
    await settle(s.page);
  }
  return s;
}

/**
 * Close the person's browser now.
 * @param key - The person.
 */
export async function closeBrowserSession(key: string): Promise<void> {
  const s = sessions.get(key);
  if (!s) {
    return;
  }
  sessions.delete(key);
  touch(s);
  if (s.poll) {
    clearInterval(s.poll);
  }
  await s.context.close().catch(() => {});
}

/**
 * Keep the browser for the person's next run, and close it once it has sat unused long enough.
 * @param key - The person.
 */
export function releaseBrowserSession(key: string): void {
  const s = sessions.get(key);
  if (!s) {
    return;
  }
  s.busy = false;
  touch(s);
  s.idle = setTimeout(() => void closeBrowserSession(key), BROWSER_RUN_LIMITS.idleMs);
  s.idle.unref?.();
}

/**
 * The person's browser when it is open, without opening one.
 * @param key
 */
export function existingSession(key: string): BrowserSession | null {
  const s = sessions.get(key);
  return s && !s.page.isClosed() ? s : null;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {});
}

/**
 * The page as the model reads it, with what the guard stopped since it last looked.
 * @param s
 * @param find
 */
export async function snapshot(s: BrowserSession, find?: string | null): Promise<{ url: string; title: string; text: string; blocked: string[] }> {
  const snap = await pageSnapshot(s.page, BROWSER_RUN_LIMITS.snapshotChars, find);
  return { ...snap, blocked: s.blocked.splice(0) };
}

/**
 * A screenshot of the page as it stands.
 * @param s
 */
export async function screenshot(s: BrowserSession): Promise<Buffer> {
  return s.page.screenshot({ type: 'jpeg', quality: 75 });
}

type Rect = { x: number; y: number; width: number; height: number };

async function chrome(page: Page, fn: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(([f, a]) => {
    const demo = (window as unknown as { __vocionDemo?: Record<string, (...x: unknown[]) => void> }).__vocionDemo;
    demo?.[f as string]?.(...(a as unknown[]));
  }, [fn, args] as const).catch(() => {});
}

/**
 * Glide the cursor to an element and outline it, so the picture shows where the browser is about to act.
 * @param page
 * @param loc
 */
async function pointAt(page: Page, loc: Locator): Promise<Rect | null> {
  await loc.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
  const box = await loc.boundingBox({ timeout: 2_000 }).catch(() => null);
  if (!box) {
    return null;
  }
  await chrome(page, 'spotlight', box);
  await chrome(page, 'moveTo', Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await page.waitForTimeout(CURSOR_GLIDE_MS);
  return box;
}

/**
 * Point at the element a held step is about and keep it outlined, so the
 * person approving sees exactly what Approve will press; `null` clears it.
 * @param s - The browser.
 * @param ref - The element, or null to clear.
 */
export async function markTarget(s: BrowserSession, ref: string | null): Promise<void> {
  const loc = ref ? byRef(s.page, ref) : null;
  if (!loc) {
    await chrome(s.page, 'spotlight', null);
    return;
  }
  await pointAt(s.page, loc);
}

/**
 * What an element is, for the approval rule: its role and what it says.
 * @param s
 * @param ref
 */
export async function describeElement(s: BrowserSession, ref: string): Promise<{ role: string | null; name: string | null } | null> {
  const loc = byRef(s.page, ref);
  if (!loc) {
    return null;
  }
  return loc.evaluate((el) => {
    const e = el as HTMLElement & { type?: string; value?: string };
    const tag = e.tagName.toLowerCase();
    const explicit = e.getAttribute('role');
    const role = explicit ?? (tag === 'button' || (tag === 'input' && ['submit', 'button', 'image'].includes(String(e.type))) ? 'button' : tag === 'a' ? 'link' : tag === 'input' || tag === 'textarea' ? 'textbox' : null);
    const labelled = (e as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> }).labels?.[0]?.textContent;
    const fieldish = role === 'textbox' || tag === 'select';
    const name = ((fieldish ? labelled || e.getAttribute('placeholder') : null) || e.getAttribute('aria-label') || e.textContent || e.value || e.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    return { role, name: name || null };
  }, undefined, { timeout: 2_000 }).catch(() => null);
}

/**
 * The submit button of the form a field sits in, when pressing Enter there would submit it.
 * @param s - The browser.
 * @param ref - The focused field, or null for whatever has focus.
 */
export async function formSubmitOf(s: BrowserSession, ref: string | null): Promise<{ role: string; name: string | null } | null> {
  const target = ref ? byRef(s.page, ref) : s.page.locator(':focus');
  if (!target) {
    return null;
  }
  return target.evaluate((el) => {
    const form = (el as HTMLElement).closest('form');
    const btn = form?.querySelector('button[type="submit"], button:not([type]), input[type="submit"]') as (HTMLElement & { value?: string }) | null;
    return btn ? { role: 'button', name: (btn.textContent || btn.value || '').trim().slice(0, 120) || null } : null;
  }, undefined, { timeout: 1_500 }).catch(() => null);
}

/** One action's outcome, in words the model and the pane both read. */
export type ActOutcome = { ok: boolean; detail: string };

/**
 * Do one action on the page. Never throws: a failed action is an outcome the model reads and recovers from.
 * @param s - The browser.
 * @param action - What to do.
 */
/** Past this many characters, text is filled in at once rather than typed key by key. */
const LONG_TEXT_CHARS = 400;

export async function act(s: BrowserSession, action:
  | { kind: 'open'; url: string }
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; submit?: boolean }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'press'; key: string }
  | { kind: 'scroll'; direction: 'up' | 'down' }
  | { kind: 'wait'; seconds: number }): Promise<ActOutcome> {
  const page = s.page;
  try {
    switch (action.kind) {
      case 'open': {
        if (!(await mayLoad(action.url))) {
          return { ok: false, detail: 'that address does not resolve to a public web page (it does not exist, or it is private), so the browser did not open it' };
        }
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await settle(page);
        return { ok: true, detail: `opened ${page.url()}` };
      }
      case 'click': {
        const loc = byRef(page, action.ref);
        if (!loc) {
          return { ok: false, detail: `"${action.ref}" is not a ref from the snapshot` };
        }
        if (!(await loc.isEnabled({ timeout: 2_000 }).catch(() => false))) {
          return { ok: false, detail: 'that element is disabled, so it was not clicked' };
        }
        const box = await pointAt(page, loc);
        if (box) {
          await chrome(page, 'ripple', Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
        }
        await loc.click({ timeout: 10_000 });
        await settle(page);
        await chrome(page, 'spotlight', null);
        return { ok: true, detail: 'clicked' };
      }
      case 'type': {
        const loc = byRef(page, action.ref);
        if (!loc) {
          return { ok: false, detail: `"${action.ref}" is not a ref from the snapshot` };
        }
        await pointAt(page, loc);
        await loc.fill('', { timeout: 10_000 });
        if (action.text.length > LONG_TEXT_CHARS) {
          // A whole article (a post's body) typed key by key outlasts any timeout; it goes in at once.
          await loc.fill(action.text, { timeout: 15_000 });
        } else {
          await loc.pressSequentially(action.text, { delay: action.text.length > 60 ? 0 : 18, timeout: 15_000 });
        }
        if (action.submit) {
          await loc.press('Enter');
          await settle(page);
        }
        await chrome(page, 'spotlight', null);
        return { ok: true, detail: action.submit ? 'typed and submitted' : 'typed' };
      }
      case 'select': {
        const loc = byRef(page, action.ref);
        if (!loc) {
          return { ok: false, detail: `"${action.ref}" is not a ref from the snapshot` };
        }
        await pointAt(page, loc);
        await loc.selectOption({ label: action.value }, { timeout: 5_000 }).catch(() => loc.selectOption(action.value, { timeout: 5_000 }));
        await chrome(page, 'spotlight', null);
        return { ok: true, detail: `chose ${action.value}` };
      }
      case 'press': {
        await chrome(page, 'keycap', action.key);
        await page.keyboard.press(action.key);
        await settle(page);
        await chrome(page, 'keycap', null);
        return { ok: true, detail: `pressed ${action.key}` };
      }
      case 'scroll': {
        await page.mouse.wheel(0, action.direction === 'down' ? 600 : -600);
        await page.waitForTimeout(400);
        return { ok: true, detail: `scrolled ${action.direction}` };
      }
      case 'wait': {
        await page.waitForTimeout(Math.min(10, Math.max(0.5, action.seconds)) * 1000);
        return { ok: true, detail: 'waited' };
      }
    }
  } catch (e) {
    await chrome(page, 'spotlight', null);
    const msg = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 240) : String(e);
    return { ok: false, detail: `${'ref' in action ? `ref ${action.ref} could not be used (take a fresh look if the page changed): ` : ''}${msg}` };
  }
}

/**
 * Mark the browser as held by a run; false when another run holds it.
 * @param s
 */
export function claim(s: BrowserSession): boolean {
  if (s.busy) {
    return false;
  }
  s.busy = true;
  touch(s);
  return true;
}
