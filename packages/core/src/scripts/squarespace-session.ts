/**
 * Sign in to a Squarespace site once, on your own machine, and keep that
 * sign-in on the workspace's Squarespace connector, so publish runs start
 * signed in (`docs/guides/squarespace.md`).
 *
 * Why. Squarespace has no API for posts, so Vocion publishes in the site's
 * editor, in a browser run in the cloud, and Squarespace refuses a password
 * typed from a data centre. A sign-in made where Squarespace trusts you (your
 * machine, two-step verification included) works from the cloud browser.
 *
 * What it does. Opens a real Chromium window at the site's /config. You sign
 * in as you always do. When the editor shows, the script saves the browser's
 * Squarespace cookies and site storage (only squarespace.com) and either
 * uploads them to the workspace (PUT /api/v1/squarespace/session, with a
 * workspace admin API token from Developers → Create token, read from
 * VOCION_API_TOKEN) or, with --out, writes them to a file an admin uploads in
 * the app (Connectors → Squarespace → Advanced → Upload a session file).
 *
 * usage:
 *   VOCION_API_TOKEN=vcn_live_… npm run squarespace:session -- \
 *     --site https://example-site.squarespace.com --workspace <slug|id> --url https://vocion.example
 *   npm run squarespace:session -- --site https://example-site.squarespace.com --out session.json
 *
 * Needs a headed Chromium once: `npx playwright install chromium`.
 */

import type { SignInFile } from '@/libs/browser/keptSignIn';
import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import process from 'node:process';
import { keepOnly, keptSignInSpecFor, SIGN_IN_FILE_KIND } from '@/libs/browser/keptSignIn';
import { editorSignedIn } from '@/services/publish/squarespaceSignIn';

/** How long a person has to sign in. */
const SIGN_IN_WAIT_MS = 10 * 60_000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const site = arg('site')?.replace(/\/+$/, '');
  const out = arg('out');
  const workspace = arg('workspace');
  const appUrl = arg('url')?.replace(/\/+$/, '');
  const token = process.env.VOCION_API_TOKEN;
  if (!site || !/^https:\/\//.test(site)) {
    fail('Give the site: --site https://example-site.squarespace.com');
  }
  if (!out && (!appUrl || !workspace || !token)) {
    fail('To upload, give --workspace <slug|id> and --url <app url>, with a workspace admin API token in VOCION_API_TOKEN (Developers → Create token). Or write a file with --out session.json and upload it in the app.');
  }
  const spec = keptSignInSpecFor('squarespace')!;

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  console.log(`Opening ${site}${spec.signInPath}. Sign in as you always do; the window closes once the editor shows.`);
  await page.goto(`${site}${spec.signInPath}`, { waitUntil: 'domcontentloaded' });

  // Signed in: the editor's address, twice in a row, with no password field on the page.
  const until = Date.now() + SIGN_IN_WAIT_MS;
  let seen = 0;
  while (seen < 2) {
    if (Date.now() > until || page.isClosed()) {
      await browser.close().catch(() => {});
      fail('No signed-in editor showed. Run it again and sign in in the window it opens.');
    }
    await page.waitForTimeout(1_500);
    const url = page.url();
    if (/^https:\/\/account\.squarespace\.com/.test(url)) {
      // Signed in to the account but not on the site: go to the site's editor.
      await page.goto(`${site}${spec.signInPath}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      continue;
    }
    const passwordShown = await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    seen = editorSignedIn(url) && !passwordShown ? seen + 1 : 0;
  }

  const state = keepOnly(await context.storageState(), spec.domains);
  await browser.close();
  console.log(`Signed in. Kept ${state.cookies.length} Squarespace cookies and ${state.origins.length} sites' storage.`);
  const file: SignInFile = { kind: SIGN_IN_FILE_KIND, site, savedAt: new Date().toISOString(), savedFrom: `the operator CLI on ${hostname()}`, state };

  if (out) {
    await writeFile(out, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote ${out}. It holds a signed-in session: upload it (Connectors → Squarespace → Advanced → Upload a session file), then delete it.`);
    return;
  }
  const res = await fetch(`${appUrl}/api/v1/squarespace/session`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ site, workspace, state: file, savedFrom: file.savedFrom }),
  });
  const body = await res.json().catch(() => null) as { session?: { connector: string; savedAt: string; resumed: number[] }; error?: { message?: string } } | null;
  if (!res.ok || !body?.session) {
    fail(`The workspace did not keep it (${res.status}): ${body?.error?.message ?? 'no reason given'}`);
  }
  const resumed = body.session.resumed.length;
  console.log(`Kept on the ${body.session.connector} connector at ${body.session.savedAt}.${resumed > 0 ? ` ${resumed} page${resumed === 1 ? '' : 's'} waiting on a sign-in carry on now.` : ''}`);
}

main().catch((e) => {
  fail(`Could not keep the sign-in: ${(e as Error).message}`);
});
