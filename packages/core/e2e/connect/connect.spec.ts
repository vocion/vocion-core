import type { Dialog, Page, Request } from '@playwright/test';
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
const VENDOR_HOSTS = ['github.com', 'api.github.com', 'slack.com', 'atlassian.com', 'auth.atlassian.com', 'hubapi.com', 'api.hubapi.com'];

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
 * Accept a confirm box, as a person pressing OK would.
 * @param dialog - The browser dialog.
 */
async function acceptDialog(dialog: Dialog): Promise<void> {
  await dialog.accept();
}

test('GitHub from the Connectors page: log in, the credential field is filled and masked, name the repository, save once', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Connect GitHub' }).click();

  // Before the login the box has a real input to paste into, not a dashed guide.
  await expect(page.getByLabel('Personal access token', { exact: true })).toBeVisible();
  await expect(page.getByText(/press Connect on its row/)).toHaveCount(0);

  await page.getByRole('link', { name: 'Log in with GitHub' }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=ok/)).toBe(true);

  // The scripted GitHub login is an app installation: no token string to show, so the field says whose it is.
  await expect(page.getByTestId('connect-stored-text')).toHaveText(/^GitHub App installation · northwind/);
  await expect(page.getByRole('button', { name: 'Show', exact: true })).toHaveCount(0);

  await page.getByLabel(/repositor/i).fill('northwind/portal');
  await page.locator('form').getByRole('button', { name: 'Add connector' }).click();

  await expect.poll(() => listedConnectors(page)).toContain('github');

  await page.goto('/dashboard/developers');

  await expect(page.getByText(/Login · northwind/)).toBeVisible();
});

test('HubSpot, paste only: one key in the add box and one Save make the connected source and list the key', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Connect HubSpot' }).click();

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

test('Slack from the Connectors page: the login makes the source itself and the add form does not reopen', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Connect Slack' }).click();
  await page.getByRole('link', { name: 'Log in with Slack' }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=ok/)).toBe(true);
  await expect.poll(() => listedConnectors(page)).toContain('slack');

  // The login was enough, so there is nothing left to add: no form, and no
  // second Slack offered.
  await expect(page.locator('form').getByRole('button', { name: 'Add connector' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Slack' })).toHaveCount(0);
});

test('a refused login lands with connect=error and says when and why under Jira', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/connectors');
  await page.getByRole('button', { name: 'Connect Jira' }).click();
  await page.getByRole('link', { name: /Log in with/ }).click();

  await expect.poll(() => requested(/\/dashboard\/connectors\?.*connect=error&reason=access_denied/)).toBe(true);

  await page.goto('/dashboard/connectors');

  await expect(page.getByTestId('connect-last-attempt').filter({ hasText: /denied access/ })).toHaveText(
    /^Last attempt [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s[AP]M: .+ denied access$/,
  );
});

test('in chat: the card logs in, the conversation carries on once by itself, and a reload does not repeat it', async ({ page }) => {
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

  const card = page.getByTestId('recommended-action-card');

  await expect(card.getByText('Connect GitHub').first()).toBeVisible({ timeout: 120_000 });
  await expect(card).not.toContainText(/approve/i);

  await card.getByRole('link', { name: 'Connect GitHub' }).click();

  await expect(page).toHaveURL(/\/dashboard\/chat\?conversation=\d+/);
  await expect(page.getByText('Which repositories should I watch?')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('I connected github. What\'s next?')).toHaveCount(1);

  await page.reload();

  await expect(page.getByText('Which repositories should I watch?')).toBeVisible();
  await expect(page.getByText('I connected github. What\'s next?')).toHaveCount(1);
  await expect(page.getByText('Which repositories should I watch?')).toHaveCount(1);
});

test('no login reached a real vendor', () => {
  expect(requestedUrls.length).toBeGreaterThan(0);
  expect(requestedUrls.filter(reachesVendor)).toEqual([]);
});
