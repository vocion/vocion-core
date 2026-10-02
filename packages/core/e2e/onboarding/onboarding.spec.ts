import type { Page, Request } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { ADMIN, seedOnboardingWorkspace } from './support/seed';

/**
 * First-run workspace setup (#1028), against the scripted model.
 *
 * The opening message is written by the server, not the model, so the first
 * visit needs no script line; the one scripted turn
 * (`e2e/onboarding/scripts/onboarding.json`) runs `workspace_setup` and then
 * `offer_connection`. Start the server with `npm run e2e:onboarding`.
 *
 * Needs a fresh database per run: setup opens once per workspace, so a second
 * run against the same database has nothing left to open.
 */

test.beforeAll(() => {
  seedOnboardingWorkspace();
});

/**
 * Sign in and land on the dashboard.
 * @param page - The browser page.
 */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Whether a request is the chat client's call to open workspace setup.
 * @param request - Any request the page makes.
 * @returns True for `onboarding.start`.
 */
function isOnboardingStartRequest(request: Request): boolean {
  return request.url().includes('/rpc/onboarding/start');
}

/**
 * Note a request in `calls` when it is a call to open workspace setup.
 * @param calls - The start calls seen so far; appended to in place.
 * @param request - Any request the page makes.
 */
function recordStartCall(calls: string[], request: Request): void {
  if (isOnboardingStartRequest(request)) {
    calls.push(request.url());
  }
}

test('first admin visit opens setup once; the connect card goes to Sources with a way back', async ({ page }) => {
  // Signing in lands on the dashboard, which redirects to chat and opens setup
  // by itself: wait for that, do not race it with a navigation of our own.
  await signIn(page);
  await page.waitForURL(/conversation=\d+/);

  await expect(page.getByText('I\'ll set it up with you')).toBeVisible();

  const setupUrl = page.url();
  const conversationId = new URL(setupUrl).searchParams.get('conversation');

  expect(conversationId).toMatch(/^\d+$/);

  // A second visit is ordinary chat: setup opens once per workspace. Wait for
  // the page to be up and for its mount-time requests, then show nothing was
  // opened: the URL has no conversation and the app's own conversation list
  // still holds exactly the one. The database is not read directly: a PGlite
  // server takes one connection, the app's.
  const mounted = page.waitForResponse(response => response.url().includes('/rpc/conversations/list'));
  // If the rule were broken, the start call fires on mount. The listener,
  // armed before the visit, records one made at any point while the page
  // loads; the bounded wait after mount catches one still on its way. A slow
  // load cannot use up the window, because the wait starts only once the page
  // is up.
  const startCalls: string[] = [];
  page.on('request', request => recordStartCall(startCalls, request));
  await page.goto('/dashboard/chat');

  await expect(page.getByRole('textbox', { name: 'Ask anything…' })).toBeVisible();

  await mounted;
  const startedAfterMount = await page.waitForRequest(isOnboardingStartRequest, { timeout: 3000 }).then(() => true, () => false);

  expect(startCalls).toEqual([]);
  expect(startedAfterMount).toBe(false);
  expect(page.url()).not.toContain('conversation=');

  const listing = await page.request.post('/rpc/conversations/list', { data: { json: { limit: 50 } } });
  const conversations: { id: number }[] = (await listing.json()).json;

  expect(conversations.map(c => String(c.id))).toEqual([conversationId]);

  await page.goto(setupUrl);
  await page.locator('textarea').last().fill('This is for Northwind engineering: ship the customer portal.');
  await page.getByRole('button', { name: 'Send message' }).last().click();
  const connect = page.getByTestId('recommended-action-open');

  await expect(connect).toHaveText('Connect GitHub');
  await expect(connect).toHaveAttribute('href', new RegExp(`/dashboard/connectors\\?add=github&returnTo=%2Fdashboard%2Fchat%3Fconversation%3D${conversationId}$`));

  await connect.click();
  await page.waitForURL(/\/dashboard\/connectors/);

  // The add-source form opens inline as a card headed "Add GitHub source", not as a dialog.
  await expect(page.getByRole('heading', { name: 'Add GitHub source' })).toBeVisible();
});
