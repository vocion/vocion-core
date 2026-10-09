import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedConnectSystems } from './support/seed';

/**
 * "Connect your systems", end to end and from the keyboard alone.
 *
 * The vendors are scripted (`scripts/connect.json`, through
 * `VOCION_CONNECT_SCRIPT`): the login window is sent to the real start route,
 * the script sends it straight back to the real callback with the real signed
 * state, and the verification's test call and first-sync count are the
 * script's `verify` answers. Everything else is real: the state check, the
 * vault, the login row, the sources, the docked card, the summary on the
 * chat card. The chat case runs the scripted model (`scripts/chat.json`),
 * which really calls `connect_system`.
 *
 * Start the server the way `npm run e2e:connect-systems` does. Screenshots go
 * to `CONNECT_SHOTS` when it is set.
 */

/** A made-up key: typed in here, sent to the vault, never shown again. */
const KEY = 'grn-e2e-not-a-real-key-connect-systems';

/** Hosts a real login would reach. A request to any of these is a failure. */
const VENDOR_HOSTS = ['hubspot.com', 'hubapi.com', 'granola.ai', 'notion.com', 'atlassian.com', 'slack.com'];

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  seedConnectSystems();
});

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.CONNECT_SHOTS ?? info.outputPath();
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * The 1-based key that picks an option on the docked card.
 * @param page - The page.
 * @param id - The option's id.
 */
async function keyFor(page: Page, id: string): Promise<string> {
  const ids = await page.getByTestId('decision-options').locator('[role="option"]').evaluateAll(els => els.map(el => el.getAttribute('data-testid')));
  const index = ids.indexOf(`decision-option-${id}`);

  expect(index, `${id} is offered`).toBeGreaterThanOrEqual(0);

  return String(index + 1);
}

test('from its link: one question, a login in its own window and a key typed inline, each verified, then the summary', async ({ page }, info) => {
  const vendorRequests: string[] = [];
  page.context().on('request', (request) => {
    const host = new URL(request.url()).hostname;
    if (VENDOR_HOSTS.some(v => host === v || host.endsWith(`.${v}`))) {
      vendorRequests.push(request.url());
    }
  });
  const bodies: string[] = [];
  page.on('response', async (response) => {
    if (/connectSystems/.test(response.url())) {
      bodies.push(await response.text().catch(() => ''));
    }
  });
  await signIn(page);
  // The Connectors page no longer carries a second way in (2026-10-09): the
  // walk starts from chat, the checklist or an app, all through this link.
  await page.goto('/dashboard/chat?objective=connect-systems');
  await shot(page, info, '01-connect-systems-entry');

  // The link is the person's ask, a real turn; the lead's connect_system
  // raises the walk's one question, as the latest item in the thread.
  await expect(page.getByText('Help me connect the systems this workspace needs')).toBeVisible({ timeout: 60_000 });

  const card = page.getByTestId('decision-card');

  await expect(card).toContainText('Which of these do you use?');
  await expect(page.getByTestId('decision-options')).toBeFocused();

  await page.keyboard.press(await keyFor(page, 'hubspot'));
  await page.keyboard.press(await keyFor(page, 'granola'));
  await shot(page, info, '02-question');
  await page.keyboard.press('Enter');

  // One at a time, with the progress line.
  await expect(card).toContainText('Connect HubSpot?');
  await expect(page.getByTestId('decision-queue')).toHaveText(' · 1 of 2');

  await shot(page, info, '03-step-login');
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  // The login ran in its own window, which handed the outcome back and closed.
  await (await popup).waitForEvent('close');

  // Verified before moving on: the next system is up.
  await expect(card).toContainText('Connect Granola?');
  await expect(page.getByTestId('decision-queue')).toHaveText(' · 2 of 2');

  await page.keyboard.press('Enter');
  const field = page.getByTestId('connect-field-token');

  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');

  await page.keyboard.type(KEY);
  await shot(page, info, '04-step-key');
  await page.keyboard.press('Enter');

  // The summary: what each found and what it unlocks.
  await expect(card).toContainText('Connected 2 of 2.');
  await expect(page.getByTestId('connect-summary-hubspot')).toContainText('Found 1,284 contacts');
  await expect(page.getByTestId('connect-summary-granola')).toContainText('Found 37 documents');

  await shot(page, info, '05-summary');

  // The key went to the vault and nowhere else: not on the page, not in any answer.
  expect(await page.locator('body').textContent()).not.toContain(KEY);
  expect(bodies.join('\n')).not.toContain(KEY);
  expect(vendorRequests).toEqual([]);

  await page.keyboard.press('Enter');

  await expect(card).toHaveCount(0);

  const sources = await (await page.request.get('/rpc/sources')).json() as { sources: Array<{ kind: string }> };

  expect(sources.sources.map(s => s.kind)).toEqual(expect.arrayContaining(['hubspot', 'granola']));
});

test('from chat: connect_system is one Decision that opens the walk; Later and Esc stop it, and Done answers it with the summary', async ({ page }, info) => {
  await signIn(page);
  await page.goto('/dashboard/chat?new=1');
  const composer = page.getByRole('textbox', { name: /^Ask / }).last();

  await expect(composer).toBeEnabled();

  await composer.fill('connect my tools');
  await page.getByRole('button', { name: 'Send message' }).last().click();

  // The agent really called connect_system: its Decision opened the walk at
  // once, and the walk is the one docked card.
  const card = page.getByTestId('decision-card');

  await expect(card).toContainText('Connect Jira?');
  await expect(card).toHaveCount(1);
  await expect(page.getByTestId('decision-queue')).toHaveText(' · 1 of 2');

  await shot(page, info, '06-chat-card');
  // 2 is Later; then Esc stops the walk where it stands.
  await page.getByTestId('decision-options').focus();
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');

  await expect(card).toContainText('Connect Notion?');

  await page.keyboard.press('Escape');

  await expect(card).toContainText('Connected 0 of 2.');

  await page.keyboard.press('Enter');

  // Done answered the Decision — typed, on the person's side, with what
  // happened — and a reload reads it from the conversation.
  const summary = 'Nothing connected · later: Jira, Notion.';

  await expect(page.getByTestId('decision-answer').last()).toContainText(summary);
  await expect(page.getByTestId('decision-card')).toHaveCount(0);

  await page.reload();

  await expect(page.getByTestId('decision-answer').last()).toContainText(summary);
  await expect(page.getByTestId('decision-answer').last()).toContainText('Connect your systems');
  await expect(page.getByTestId('decision-card')).toHaveCount(0);
});

test('a failed check stays on the system with its reason and Try again first', async ({ page }, info) => {
  await signIn(page);
  await page.goto('/dashboard/chat?objective=connect-systems&named=notion');
  const card = page.getByTestId('decision-card');

  await expect(card).toContainText('Connect Notion?');

  await page.keyboard.press('Enter');
  const field = page.getByTestId('connect-field-token');

  await expect(field).toBeFocused();

  await page.keyboard.type('ntn-e2e-not-a-real-key');
  await page.keyboard.press('Enter');

  await expect(card).toContainText('Notion did not connect');
  await expect(card).toContainText('Notion refused the key: it is not valid.');
  await expect(page.getByTestId('decision-option-retry')).toHaveAttribute('aria-selected', 'true');

  await shot(page, info, '07-failed');
  // Later, and the walk ends on its summary.
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');

  await expect(card).toContainText('Connected 0 of 1.');
  await expect(page.getByTestId('connect-summary-notion')).toHaveAttribute('data-outcome', 'later');
});

test('from an app\'s page: one move connects the systems that app reads, and the walk names the app', async ({ page }, info) => {
  await signIn(page);
  await page.goto('/dashboard/apps/gtm');
  const link = page.getByTestId('app-connect-all');

  await expect(link).toBeVisible();
  await expect(link).toContainText(/Connect the (\d+ systems|system) GTM uses/);

  await shot(page, info, '08-app-page');
  await link.focus();
  await page.keyboard.press('Enter');

  const card = page.getByTestId('decision-card');

  // The link asked the lead in the person's words; the lead raised the walk.
  await expect(page.getByText('Help me connect the systems GTM uses')).toBeVisible();
  await expect(page.getByTestId('decision-eyebrow')).toContainText('GTM setup');
  // Scoped to one app: no question, straight to the first system.
  await expect(card).not.toContainText('Which of these do you use?');

  await shot(page, info, '09-app-walk');
  await page.keyboard.press('Escape');

  await expect(card).toContainText(/Connected 0 of \d+\./);
});
