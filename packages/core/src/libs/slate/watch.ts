/**
 * Launching a Slate recording from Vocion, and finding it once it is done —
 * the two halves around `recording.ts` for "teach a routine by showing it".
 *
 * What Slate allows, read from its source (slate-chrome, slate-web, slate-mac,
 * slate-api; 2026-10-22):
 *
 * - **No page can start the Chrome extension.** Its manifest declares no
 *   `externally_connectable`, no static content script and no URL it
 *   intercepts (slate-chrome `scripts/build.mjs`, `src/background/index.ts`);
 *   a take starts from its toolbar button or the hotkey ⌥⇧R / Alt+Shift+R
 *   (`commands.toggle-recording`), which brings up Chrome's own "choose what
 *   to share" picker. So the launch is: open the page being taught in a new
 *   tab, then the person presses ⌥⇧R there. The extension records the tabs
 *   visited as activity (`src/background/activity.ts`), so `get_activity`
 *   answers for its recordings too, not only the Mac app's.
 * - **The Mac app has a deep link**: `slate://panel` opens its recorder panel
 *   (slate-mac `Sources/Slate/SlateApp.swift`); Record is still pressed there.
 * - **The web recorder has none**: it opens from the Record button on
 *   `/library` (slate-web `src/recorder/RecorderOverlay.tsx`; the
 *   `deep_link` entry it names is never wired).
 * - **No title can be set at launch.** Slate titles a recording itself once
 *   it is processed (`titleSource: "ai"`); `update_video` renames it after.
 * - **No webhooks.** slate-api has none for customers (only Stripe in, and
 *   its own Slack/email/push notifications out), so a finished recording is
 *   found by polling {@link findNewRecording}.
 */

import type { SlateCredentials, SlateFetch, SlateResult } from './client';
import { SLATE_API_BASE } from './client';
import { slateTool } from './recording';

export const SLATE_WEB_BASE = 'https://slatevideo.com';
/** The Chrome Web Store item id of the production extension (slate-chrome README). */
export const SLATE_CHROME_EXTENSION_ID = 'dpjnlbklkmdiicdfijfojigamiabboac';
export const SLATE_CHROME_STORE_URL = `https://chromewebstore.google.com/detail/${SLATE_CHROME_EXTENSION_ID}`;
/** The Mac app's recorder panel. The browser asks once whether to open Slate. */
export const SLATE_MAC_PANEL_URL = 'slate://panel';
export const SLATE_RECORD_HOTKEY = { mac: '⌥⇧R', other: 'Alt+Shift+R' } as const;

/** How to get a person recording, best path first. */
export type SlateLaunch = {
  /** Open this in a new tab first: the page the routine is taught on. Null when none was given or it is not http(s). */
  targetUrl: string | null;
  /** The Chrome extension: press the hotkey (or its toolbar button) on the target tab. */
  extension: { id: string; storeUrl: string; hotkey: typeof SLATE_RECORD_HOTKEY };
  /** The Mac app's recorder panel, for a person with Slate for Mac. */
  macPanelUrl: string;
  /** Slate's web recorder (the Record button on the library), for a person with neither. */
  webRecorderUrl: string;
  /** What to tell the person, in one sentence. */
  instruction: string;
  /** What the person said the recording is; Slate cannot take it at launch, so match or rename with it after. */
  titleHint: string | null;
};

function webBaseFor(apiBase: string | undefined): string {
  if (!apiBase || apiBase === SLATE_API_BASE) {
    return SLATE_WEB_BASE;
  }
  try {
    const u = new URL(apiBase);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return `${u.protocol}//${u.hostname}:5173`;
    }
    // api.example.com → example.com; dev-api.example.com → dev.example.com
    const host = u.hostname.replace(/^api\./, '').replace(/^([\w-]+)-api\./, '$1.');
    return `${u.protocol}//${host}`;
  } catch {
    return SLATE_WEB_BASE;
  }
}

function httpUrl(raw: string | undefined): URL | null {
  if (!raw) {
    return null;
  }
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * The way to start a recording of a routine. No URL starts Slate's Chrome
 * extension (see the header), so this is a plan rather than one link: open
 * `targetUrl` in a new tab, then the person presses ⌥⇧R there (or the Slate
 * button). Without the extension, `macPanelUrl` opens the Mac app's panel and
 * `webRecorderUrl` is Slate's library, whose Record button records in the page.
 * @param opts - What is being taught.
 * @param opts.title - What the routine is called, for matching the finished recording.
 * @param opts.targetUrl - The page the routine is done on.
 * @param opts.apiBase - Slate's API origin; the web origin follows from it.
 * @param opts.webBase - Slate's web origin, when it does not follow.
 */
export function slateRecordUrl(opts: { title?: string; targetUrl?: string; apiBase?: string; webBase?: string } = {}): SlateLaunch {
  const target = httpUrl(opts.targetUrl);
  const web = (httpUrl(opts.webBase)?.origin ?? webBaseFor(opts.apiBase)).replace(/\/+$/, '');
  const where = target ? `on the ${target.hostname} tab` : 'on the page you are teaching';
  return {
    targetUrl: target?.toString() ?? null,
    extension: { id: SLATE_CHROME_EXTENSION_ID, storeUrl: SLATE_CHROME_STORE_URL, hotkey: SLATE_RECORD_HOTKEY },
    macPanelUrl: SLATE_MAC_PANEL_URL,
    webRecorderUrl: `${web}/library`,
    instruction: `Press ${SLATE_RECORD_HOTKEY.mac} (Alt+Shift+R) or the Slate button ${where}, choose that tab, then do the task while saying what you are doing and why; press Stop when it is done.`,
    titleHint: opts.title?.trim() || null,
  };
}

/** A recording found after a launch. `ready` is true once it and its transcript are processed. */
export type SlateNewRecording = {
  url: string;
  id: string;
  title: string | null;
  createdAt: string;
  ready: boolean;
  /** Slate's own states: `uploading | processing | ready | failed`, and `pending | ready | failed | none`. */
  status: string;
  transcript: string;
  /** Slate gave up on it (the video or its transcript failed); polling further will not help. */
  failed: boolean;
};

/**
 * The newest recording the token's own person made since `since`, and whether
 * it is ready to read (video processed and transcript ready). Null while
 * nothing has arrived. A team key (`slk_…`) owns no recordings, so this needs
 * the person's session token. When several arrived, one whose title or
 * summary contains `titleHint` wins, else the newest.
 * @param c - Where and as whom.
 * @param opts - What to look for.
 * @param opts.since - When the recording was launched.
 * @param opts.titleHint - What the recording should be about.
 * @param doFetch - The network.
 */
export async function findNewRecording(c: SlateCredentials, opts: { since: Date; titleHint?: string }, doFetch?: SlateFetch): Promise<SlateResult<SlateNewRecording | null>> {
  const r = await slateTool(c, 'find_videos', { mine: true, since: opts.since.toISOString(), sort: 'newest', limit: 10 }, doFetch);
  if (!r.ok) {
    return r;
  }
  let videos: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(r.data.text) as { videos?: unknown };
    videos = Array.isArray(parsed.videos) ? parsed.videos as Array<Record<string, unknown>> : [];
  } catch {
    return { ok: false, status: null, retryable: true, message: 'Slate answered the recording search in a shape Vocion does not read.' };
  }
  const since = opts.since.getTime();
  const found = videos
    .filter(v => typeof v.id === 'string' && typeof v.url === 'string' && v.yours !== false && v.archived !== true)
    .filter(v => typeof v.createdAt !== 'string' || Date.parse(v.createdAt) >= since)
    .sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)));
  const hint = opts.titleHint?.trim().toLowerCase();
  const pick = (hint && found.find(v => `${v.title ?? ''} ${v.summary ?? ''}`.toLowerCase().includes(hint))) || found[0];
  if (!pick) {
    return { ok: true, data: null };
  }
  const status = typeof pick.status === 'string' ? pick.status : 'unknown';
  const transcript = typeof pick.transcript === 'string' ? pick.transcript : 'none';
  return {
    ok: true,
    data: {
      url: pick.url as string,
      id: pick.id as string,
      title: typeof pick.title === 'string' ? pick.title : null,
      createdAt: typeof pick.createdAt === 'string' ? pick.createdAt : new Date(since).toISOString(),
      ready: status === 'ready' && transcript === 'ready',
      status,
      transcript,
      failed: status === 'failed' || (status === 'ready' && transcript === 'failed'),
    },
  };
}
