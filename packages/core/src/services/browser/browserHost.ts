/**
 * WHERE A PERSON'S BROWSER RUNS — never in the document renderer, and outside
 * the app's own process wherever the installation allows it.
 *
 * A page a browser run opens is anyone's code. Rendered in the app's Chromium
 * with no sandbox (the document renderer's, `libs/documents/render.ts`, which
 * only ever renders our own HTML), a renderer exploit would run as the app,
 * beside its environment and its database login. So, in order of preference:
 *
 *   remote      `VOCION_BROWSER_ENDPOINT` (ws://…): a browser server in its
 *               own container (`infra/aws/docker-compose.prod.yml` `browser`),
 *               on a network only the app joins, with no capabilities, no
 *               secrets and no database login. The app drives it over
 *               Playwright's protocol; every request it makes still passes
 *               the app's guard (`browserEngine.mayLoad`).
 *   sandboxed   a Chromium of its own on this machine with Chrome's sandbox
 *               on (a laptop, a host that allows it).
 *   unsandboxed the same, where the sandbox cannot start (a container with no
 *               user namespaces): still its own process, started with an
 *               environment holding nothing of the app's.
 *
 * What the pane says about where it ran comes from here (`browserIsolation`).
 */

import type { Browser } from 'playwright';
import { tmpdir } from 'node:os';
import process from 'node:process';

export type BrowserIsolation = 'remote' | 'sandboxed' | 'unsandboxed';

let host: Promise<{ browser: Browser; isolation: BrowserIsolation }> | null = null;

/**
 * The environment a local browser starts with: enough to find fonts and write temp files, and
 * nothing else of the app's (no keys, no database URL).
 */
function bareEnv(): Record<string, string> {
  const keep = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE'];
  const env: Record<string, string> = { HOME: tmpdir(), TMPDIR: tmpdir() };
  for (const k of keep) {
    const v = process.env[k];
    if (v) {
      env[k] = v;
    }
  }
  return env;
}

async function open(): Promise<{ browser: Browser; isolation: BrowserIsolation }> {
  const { chromium } = await import('playwright');
  const endpoint = process.env.VOCION_BROWSER_ENDPOINT?.trim();
  if (endpoint) {
    try {
      return { browser: await chromium.connect(endpoint, { timeout: 15_000 }), isolation: 'remote' };
    } catch (e) {
      // The browser container is down or not deployed: runs carry on in a browser of their own here,
      // and say so on each run (`isolation`), rather than failing.
      console.warn('[browser] the browser container could not be reached; using a local browser', { reason: (e as Error).message.split('\n')[0] });
    }
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const base = { headless: true, env: bareEnv(), ...(executablePath ? { executablePath } : {}) };
  try {
    return { browser: await chromium.launch({ ...base, chromiumSandbox: true }), isolation: 'sandboxed' };
  } catch (e) {
    console.warn('[browser] Chrome\'s sandbox could not start here; browser runs use their own unsandboxed Chromium', { reason: (e as Error).message.split('\n')[0] });
    return { browser: await chromium.launch({ ...base, chromiumSandbox: false, args: ['--disable-dev-shm-usage', '--disable-gpu'] }), isolation: 'unsandboxed' };
  }
}

/** The browser that people's browser runs open their contexts in, started or connected on first use. */
export async function browserHost(): Promise<Browser> {
  return (await hostInfo()).browser;
}

async function hostInfo(): Promise<{ browser: Browser; isolation: BrowserIsolation }> {
  if (!host) {
    host = open().then((h) => {
      // A browser server restarted, or a local browser that crashed: the next run opens a new one.
      h.browser.on('disconnected', () => {
        host = null;
      });
      return h;
    }, (e) => {
      host = null;
      throw e;
    });
  }
  return host;
}

/** Where the browser runs, once it has been opened; null before. */
export async function browserIsolation(): Promise<BrowserIsolation | null> {
  return host ? (await host.catch(() => null))?.isolation ?? null : null;
}
