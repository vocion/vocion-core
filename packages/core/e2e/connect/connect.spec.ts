import type { Dialog, Page, Request } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedConnectWorkspace } from './support/seed';

/**
 * Connecting a tool by logging in (#1080), from the Connectors page and from
 * chat, as a person meets it.
 *
 * The vendors are scripted (`e2e/connect/scripts/connect.json`, read through
 * `VOCION_CONNECT_SCRIPT`): the browser is sent to the real start route, the
 * script sends it straight back to the real callback with the real signed
 * state, and the script says what the vendor answered. Everything else is
 * real: the state check, the credential vault, the login row, the source, the
 * landing page. The chat half also runs the scripted model
 * (`scripts/chat.json`), which really calls `offer_connection`.
 *
 * Start the server the way `npm run e2e:connect` does:
 *   VOCION_LLM_PROVIDER=scripted VOCION_LLM_SCRIPT=e2e/connect/scripts/chat.json
 *   VOCION_CONNECT_SCRIPT=e2e/connect/scripts/connect.json
 *   WORKSPACE_PATH=templates/workspaces/client-documents
 *
 * The cases share one workspace and run in order: the GitHub login made on
 * the Connectors page is revoked before the chat case, so chat has a
 * connector to offer.
 */

/** Hosts a real login would reach. A request to any of these is a failure. */
const VENDOR_HOSTS = [
  'github.com',
  'slack.com',
  'atlassian.com',
  'hubspot.com',
  'hubapi.com',
  'google.com',
  'googleapis.com',
  'notion.com',
  'zoom.us',
  'apollo.io',
  'posthog.com',
];

/** Every URL the browser asked for, across all cases. */
const requestedUrls: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  seedConnectWorkspace();
});

/**
 * Remember a request, for the "never reached a vendor" case.
 * @param request - The request the page made.
 */
function recordRequest(request: Request): void {
  requestedUrls.push(request.url());
}

/**
 * Whether a URL's host is a vendor host or a subdomain of one.
 * @param url - A request URL.
 */
function reachesVendor(url: string): boolean {
  const host = new URL(url).hostname;
  return VENDOR_HOSTS.some(vendor => host === vendor || host.endsWith(`.${vendor}`));
}

/**
 * Press a connector's Connect on the Connectors page. The catalog folds past a
 * screenful ("Show 7 more"), so the connector may be behind it.
 * @param page - The browser page.
 * @param name - The connector's name.
 */
async function openConnect(page: Page, name: string) {
  const connect = page.getByRole('button', { name: `Connect ${name}` });
  const more = page.getByRole('button', { name: /^Show \d+ more/ });

  await expect(connect.or(more).first()).toBeVisible();

  if (!(await connect.isVisible())) {
    await more.click();
  }
  await connect.click();
}

/**
 * Sign in and land on the dashboard.
 * @param page - The browser page.
 */
async function signIn(page: Page) {
  page.on('request', recordRequest);
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Whether the browser has asked for a URL matching this pattern so far.
 * @param pattern - What the URL must match.
 */
function requested(pattern: RegExp): boolean {
  return requestedUrls.some(url => pattern.test(url));
}

/**
 * The workspace's sources, read the way the Connectors page reads them.
 * @param page - A signed-in page.
 */
async function listedConnectors(page: Page): Promise<string[]> {
  const response = await page.request.get('/rpc/sources');
  const body = await response.json() as { sources: Array<{ kind: string }> };
  return body.sources.map(source => source.kind);
}

/** A made-up key: the test types it in and nothing ever sends it anywhere. */
const HUBSPOT_KEY = 'pat-na1-e2e-not-a-real-key-0001';
const FAIL_LAST_SYNC = 'e2e/connect/support/fail-last-sync.ts';
/** What a sync records when HubSpot refuses the login's refresh (`refreshFailure` in libs/connect/loginGrant.ts). */
const REFUSED_LOGIN = 'HubSpot would not refresh the login (invalid_grant). An admin needs to log in with HubSpot again on the Connectors page.';

/** A made-up Granola key, saved on the Developers page and then shown on the Connectors form. */
const GRANOLA_KEY = 'grn-e2e-not-a-real-key-0002';

/** A made-up HubSpot login app, saved on Developers. Nothing sends it anywhere: the login it starts is checked, never opened. */
const HUBSPOT_APP_CLIENT_ID = 'e2e-hubspot-app-client';
const HUBSPOT_APP_SECRET = 'e2e-not-a-real-secret-0003';
/** The HubSpot login app a script saves through `/api/v1/login-apps`, replacing the one above. */
const HUBSPOT_API_APP_CLIENT_ID = 'e2e-hubspot-api-app-client';
const HUBSPOT_API_APP_SECRET = 'e2e-not-a-real-secret-0004';

/**
 * Whether the workspace's HubSpot source reads as connected, the way the
 * Connectors page reads it.
 * @param page - A signed-in page.
 */
async function hubspotConnected(page: Page): Promise<boolean> {
  const response = await page.request.get('/rpc/sources');
  const body = await response.json() as { sources: Array<{ slug: string; credentialConnected: boolean }> };
  return body.sources.some(source => source.slug.startsWith('hubspot') && source.credentialConnected);
}

/**
 * The id of the HubSpot source the paste case made.
 * @param page - A signed-in page.
 */
async function hubspotSourceId(page: Page): Promise<number> {
  const response = await page.request.get('/rpc/sources');
  const body = await response.json() as { sources: Array<{ id: number; slug: string }> };
  const source = body.sources.find(candidate => candidate.slug.startsWith('hubspot'));
  if (!source) {
    throw new Error('No HubSpot source: this case runs after the HubSpot paste case, which makes it.');
  }
  return source.id;
}

/**
 * Record a failed last sync on a source, as a sync that ended on a refused
 * login records it, without calling the vendor.
 * @param sourceId - The source whose last run failed.
 * @param error - What the run ended with.
 */
function failLastSync(sourceId: number, error: string): void {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', FAIL_LAST_SYNC, String(sourceId), error], { stdio: ['ignore', 'inherit', 'pipe'] });
}

/**
 * Press "Add credential" on the Developers page unless its form is already up,
 * and say whether it is up now. Polled, because on a cold dev server the first
 * click can land before React has wired the button.
 * @param page - A signed-in page on the Developers page.
 */
async function credentialFormOpened(page: Page): Promise<boolean> {
  const platformSelect = page.getByLabel('Platform', { exact: true });
  if (!await platformSelect.isVisible()) {
    await page.getByRole('button', { name: 'Add credential' }).click();
  }
  return platformSelect.isVisible();
}

/**
 * Accept a confirm box, as a person pressing OK would.
 * @param dialog - The browser dialog.
 */
async function acceptDialog(dialog: Dialog): Promise<void> {
  await dialog.accept();
}

test('GitHub from the Connectors page: log in, the credential field is filled and masked, name the repository, save once', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await openConnect(page, 'GitHub');

  // Before the login the box has a real input to paste into, not a dashed guide.
  await expect(page.getByLabel('Personal access token', { exact: true })).toBeVisible();
  await expect(page.getByText(/press Connect on its row/)).toHaveCount(0);

  // Dressed as GitHub's own login, so the person sees whose login opens next.
  await expect(page.getByRole('link', { name: 'Log in with GitHub' })).toHaveAttribute('data-brand', 'github');

  await page.getByRole('link', { name: 'Log in with GitHub' }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=ok/)).toBe(true);

  // The scripted GitHub login is an app installation: no token string to show, so the field says whose it is.
  await expect(page.getByTestId('connect-stored-text')).toHaveText(/^GitHub App installation · northwind/);
  await expect(page.getByRole('button', { name: 'Show', exact: true })).toHaveCount(0);

  await page.getByLabel(/repositor/i).fill('northwind/portal');
  // Saving asks for the new source's schedule and first sync, and says whether they started. This
  // server runs no job executor (no VOCION_SCHEDULE_OWNER), so its scheduler has no tables and the
  // answer is "failed": the save must still succeed, and the page must say to press Sync now.
  const saveResponse = page.waitForResponse(response => response.request().method() === 'POST' && /\/rpc\/connect\/addConnector/.test(response.url()));
  await page.locator('form').getByRole('button', { name: 'Add connector' }).click();

  expect(JSON.stringify(await (await saveResponse).json())).toMatch(/"ok":true,"sourceId":\d+,"firstSync":"failed"/);
  await expect(page.getByText('Saved, but its first sync could not start. Press Sync now on its row to try again.')).toBeVisible();

  await expect.poll(() => listedConnectors(page)).toContain('github');

  await page.goto('/dashboard/developers');

  await expect(page.getByText(/Login · northwind/)).toBeVisible();
});

test('HubSpot, with no HubSpot app set up on this server: paste only, one key in the add box and one Save make the connected source and list the key', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await openConnect(page, 'HubSpot');

  // Paste only: inputs and guidance, never a login button.
  await expect(page.getByRole('link', { name: /Log in with/ })).toHaveCount(0);
  await expect(page.getByText('CRM object read access')).toBeVisible();

  const field = page.getByLabel('Private-app token', { exact: true });

  await expect(field).toHaveAttribute('type', 'password');

  await field.fill(HUBSPOT_KEY);
  await page.getByRole('button', { name: 'Show Private-app token' }).click();

  await expect(field).toHaveAttribute('type', 'text');

  await page.locator('form').getByRole('button', { name: 'Add connector' }).click();

  // One Save: no second dialog asks for the credential.
  await expect(page.getByRole('heading', { name: /^Connect hubspot/ })).toHaveCount(0);
  await expect.poll(() => hubspotConnected(page)).toBe(true);

  await page.goto('/dashboard/developers');

  await expect(page.getByRole('row').filter({ hasText: 'HubSpot' }).first()).toBeVisible();
});

test('a HubSpot sync that ended on a refused login: the row says an admin must log in again, and its Reconnect opens the connect dialog', async ({ page }) => {
  await signIn(page);
  failLastSync(await hubspotSourceId(page), REFUSED_LOGIN);
  await page.goto('/dashboard/connectors');

  await expect(page.getByText(/An admin needs to log in with HubSpot again on the Connectors page/).first()).toBeVisible();

  // Edit never runs a login again, so the row itself has to offer the fix.
  await page.getByRole('button', { name: 'Reconnect' }).click();

  await expect(page.getByRole('heading', { name: /^Connect hubspot/ })).toBeVisible();
});

test('a key saved on Developers: the Connectors form shows only its tail until Show, and Hide takes the value off the page', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/developers');

  await expect.poll(() => credentialFormOpened(page), { timeout: 30_000 }).toBe(true);

  await page.getByLabel('Platform', { exact: true }).selectOption('granola');
  await page.getByLabel('Name').fill('Granola key');
  await page.getByLabel('API key', { exact: true }).fill(GRANOLA_KEY);
  await page.getByRole('button', { name: 'Save key' }).click();

  await expect(page.getByRole('row').filter({ hasText: 'Granola key' })).toBeVisible();

  await page.goto('/dashboard/connectors');
  await openConnect(page, 'Granola');
  const stored = page.getByTestId('connect-stored-text');

  // The page carries the masked tail, never the key.
  await expect(stored).toHaveText(`Saved key · ••••${GRANOLA_KEY.slice(-4)}`);
  expect(await page.content()).not.toContain(GRANOLA_KEY);

  // Show asks the server (admin-only, audited) and fills an editable input.
  await page.getByRole('button', { name: 'Show', exact: true }).click();

  await expect(page.getByLabel('API key', { exact: true })).toHaveValue(GRANOLA_KEY);

  // Hide on an untouched value drops it from the page and the masked line returns.
  await page.getByRole('button', { name: 'Hide API key' }).click();

  await expect(stored).toHaveText(`Saved key · ••••${GRANOLA_KEY.slice(-4)}`);
  expect(await page.content()).not.toContain(GRANOLA_KEY);
});

test('a HubSpot login app saved on Developers: with no HubSpot app on the server, the connect dialog now offers the login, and it starts on the workspace\'s client', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/developers');

  await expect.poll(() => credentialFormOpened(page), { timeout: 30_000 }).toBe(true);

  await page.getByLabel('Platform', { exact: true }).selectOption('hubspot-login-app');

  // The vendor has to be told this server's callback, so the form shows the exact URL.
  await expect(page.getByText(/\/api\/connect\/hubspot\/callback$/)).toBeVisible();

  await page.getByLabel('Name').fill('Northwind HubSpot app');
  await page.getByLabel('Client ID', { exact: true }).fill(HUBSPOT_APP_CLIENT_ID);
  await page.getByLabel('Client secret', { exact: true }).fill(HUBSPOT_APP_SECRET);
  await page.getByRole('button', { name: 'Save key' }).click();

  await expect(page.getByRole('row').filter({ hasText: 'Northwind HubSpot app' })).toBeVisible();
  expect(await page.content()).not.toContain(HUBSPOT_APP_SECRET);

  // Until now HubSpot offered paste only (no app on this server); the HubSpot
  // row still carries the refused login from the case above, so it offers Reconnect.
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  const login = page.getByRole('link', { name: 'Connect with HubSpot' });

  await expect(login).toBeVisible();

  // Ask our own start route where it sends the person, without going there,
  // so no real vendor is reached.
  const start = await page.request.get((await login.getAttribute('href'))!, { maxRedirects: 0 });

  expect(start.status()).toBe(302);

  const vendor = new URL(start.headers().location!);

  expect(vendor.host).toBe('app.hubspot.com');
  expect(vendor.searchParams.get('client_id')).toBe(HUBSPOT_APP_CLIENT_ID);
});

test('a HubSpot login app saved through /api/v1: it replaces the Developers one, the login starts on it, and revoking it takes the login away', async ({ page }) => {
  await signIn(page);

  // An admin's session, as a script run from the dashboard would carry; a
  // tenant token goes through the same route and the same admin check.
  const saved = await page.request.put('/api/v1/login-apps/hubspot', {
    data: { clientId: HUBSPOT_API_APP_CLIENT_ID, clientSecret: HUBSPOT_API_APP_SECRET, name: 'Northwind HubSpot app (API)' },
  });
  const savedText = await saved.text();

  expect(saved.status()).toBe(200);
  // A different client ID from the Developers one, so logins made with that
  // app need logging in again, and the answer says so.
  expect(JSON.parse(savedText).loginApp).toMatchObject({ provider: 'hubspot', replaced: true, loginsNeedLoggingInAgain: true });
  expect(savedText).not.toContain(HUBSPOT_API_APP_SECRET);

  const listed = await page.request.get('/api/v1/login-apps');
  const hubspot = (await listed.json()).loginApps.find((app: { provider: string }) => app.provider === 'hubspot');

  expect(hubspot).toMatchObject({ saved: true, name: 'Northwind HubSpot app (API)' });

  // The Developers page shows what the API saved.
  await page.goto('/dashboard/developers');

  await expect(page.getByRole('row').filter({ hasText: 'Northwind HubSpot app (API)' })).toBeVisible();

  // The login now starts on the app the API saved.
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Reconnect' }).click();
  const startHref = (await page.getByRole('link', { name: 'Connect with HubSpot' }).getAttribute('href'))!;
  const start = await page.request.get(startHref, { maxRedirects: 0 });

  expect(new URL(start.headers().location!).searchParams.get('client_id')).toBe(HUBSPOT_API_APP_CLIENT_ID);

  // Revoked, and with no HubSpot app on this server, there is nothing to log in with.
  const revoked = await page.request.delete('/api/v1/login-apps/hubspot');

  expect(await revoked.json()).toEqual({ revoked: true });
  expect((await page.request.get(startHref, { maxRedirects: 0 })).status()).toBe(400);
});

test('Slack from the Connectors page: the login makes the source itself and the add form does not reopen', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await openConnect(page, 'Slack');

  await expect(page.getByRole('link', { name: 'Log in with Slack' })).toHaveAttribute('data-brand', 'slack');

  await page.getByRole('link', { name: 'Log in with Slack' }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=ok/)).toBe(true);
  await expect.poll(() => listedConnectors(page)).toContain('slack');

  // The login was enough, so there is nothing left to add: no form, and no
  // second Slack offered.
  await expect(page.locator('form').getByRole('button', { name: 'Add connector' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Slack' })).toHaveCount(0);
});

/** Connectors whose login alone makes the source, each logging in with its vendor's own button. */
const LOGIN_IS_ENOUGH = [
  { connector: 'gmail', name: 'Gmail', provider: 'google', providerLabel: 'Google' },
  { connector: 'notion', name: 'Notion', provider: 'notion', providerLabel: 'Notion' },
  { connector: 'zoom', name: 'Zoom', provider: 'zoom', providerLabel: 'Zoom' },
  { connector: 'apollo', name: 'Apollo', provider: 'apollo', providerLabel: 'Apollo' },
] as const;

for (const login of LOGIN_IS_ENOUGH) {
  test(`${login.name} from the Connectors page: the ${login.providerLabel} login wears its brand and makes the source itself`, async ({ page }) => {
    await signIn(page);
    await page.goto('/dashboard/connectors');
    await openConnect(page, login.name);

    const button = page.getByRole('link', { name: `Log in with ${login.providerLabel}` });

    await expect(button).toHaveAttribute('data-brand', login.provider);

    await button.click();

    await expect.poll(() => requested(new RegExp(`/api/connect/${login.provider}/callback`))).toBe(true);
    await expect.poll(() => listedConnectors(page)).toContain(login.connector);
    await expect(page.getByRole('button', { name: `Connect ${login.name}` })).toHaveCount(0);
  });
}

test('in chat: a refused login keeps the setup step docked and says on it why — nothing is answered, nothing said for the person', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/chat');
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill('connect jira');
  await page.getByRole('button', { name: 'Send message' }).last().click();

  // The connect card is a setup Decision docked above the composer; its
  // option opens the login.
  const step = page.getByRole('dialog', { name: 'Connect Jira' });

  await expect(step.getByTestId('decision-option-opens').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  await step.getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => requested(/\/dashboard\/chat\?conversation=\d+&connect=error&reason=access_denied/)).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Connect Jira' }).getByRole('alert')).toContainText('didn\'t work (access_denied)', { timeout: 60_000 });
  await expect(page.getByText(/Connecting jira didn't work .* What should I try\?/)).toHaveCount(0);

  await page.reload();

  await expect(page.getByRole('dialog', { name: 'Connect Jira' })).toBeVisible({ timeout: 60_000 });
});

test('a refused login lands with connect=error and says when and why under Jira', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await openConnect(page, 'Jira');
  await page.getByRole('link', { name: /Log in with/ }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=error&reason=access_denied/)).toBe(true);

  await page.goto('/dashboard/connectors');

  await expect(page.getByTestId('connect-last-attempt').filter({ hasText: /denied access/ })).toHaveText(
    /^Last attempt [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s[AP]M: .+ denied access$/,
  );
});

test('in chat: the setup step logs in, the step is answered typed, the conversation carries on once, and a reload does not repeat it', async ({ page }) => {
  await signIn(page);

  // The GitHub login from the first case is revoked, so GitHub is not
  // connected any more and chat has something to offer.
  page.on('dialog', acceptDialog);
  await page.goto('/dashboard/developers');
  await page.getByRole('row').filter({ hasText: /Login · northwind/ }).getByRole('button', { name: 'Revoke' }).click();

  await expect(page.getByText(/Login · northwind/)).toHaveCount(0);

  await page.goto('/dashboard/chat');
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill('connect github');
  await page.getByRole('button', { name: 'Send message' }).last().click();

  const step = page.getByRole('dialog', { name: 'Connect GitHub' });

  await expect(step.getByTestId('decision-option-opens').first()).toBeVisible({ timeout: 120_000 });
  await expect(step).not.toContainText(/approve/i);
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  await step.getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/dashboard\/chat\?conversation=\d+/);
  await expect(page.getByText('Which repositories should I watch?')).toBeVisible({ timeout: 120_000 });
  // Typed, on the person's side, never their words.
  await expect(page.getByTestId('decision-answer').last()).toContainText('Connect GitHub');
  await expect(page.getByText('I connected github. What\'s next?')).toHaveCount(0);

  await page.reload();

  await expect(page.getByText('Which repositories should I watch?')).toBeVisible();
  await expect(page.getByText('Which repositories should I watch?')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Connect GitHub' })).toHaveCount(0);
});

test('no login reached a real vendor', () => {
  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(requestedUrls.filter(reachesVendor)).toEqual([]);
});
