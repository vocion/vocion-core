import type { Page } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedOnboarding } from './support/seed';

/**
 * A new workspace, set up by chat: it opens on its lead, the lead interviews
 * (three questions) and proposes a plan as one-click cards, and each card the
 * person presses runs as their action, with Undo, while the sidebar's Getting
 * started checklist counts it.
 *
 * The model is scripted (`scripts/chat.json`): it really calls `setup_options`
 * and `propose_setup`, so the cards, the actions behind them, the undo and the
 * checklist are all real. Start the server the way `npm run e2e:onboarding`
 * does:
 *   VOCION_LLM_PROVIDER=scripted VOCION_LLM_SCRIPT=e2e/onboarding/scripts/chat.json
 *
 * A screenshot is kept at every step (`ONBOARDING_SHOTS_DIR`, else the
 * test's output folder).
 */

test.describe.configure({ mode: 'serial' });

let workspace: { slug: string; name: string };

test.beforeAll(() => {
  workspace = seedOnboarding();
});

/**
 * Keep a picture of where the person is.
 * @param page - The browser page.
 * @param name - The step, as a file name.
 */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.ONBOARDING_SHOTS_DIR ?? test.info().outputPath();
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * Sign in and open the new workspace's chat.
 * @param page - The browser page.
 */
async function openChat(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
  await page.goto(`/w/${workspace.slug}/dashboard/chat`);
  await page.waitForURL(/\/dashboard\/chat/);
}

/**
 * Say something in the composer and send it.
 * @param page - The browser page.
 * @param text - What the person says.
 */
async function say(page: Page, text: string): Promise<void> {
  const box = page.locator('textarea').last();
  await box.click();
  await box.fill(text);
  await page.getByRole('button', { name: 'Send message' }).last().click();
}

test('a new workspace opens on its lead\'s one-line hello, one setup chip and a Getting started row', async ({ page }) => {
  await openChat(page);

  const intro = page.getByTestId('lead-intro');

  await expect(intro).toBeVisible({ timeout: 60_000 });
  await expect(intro).toContainText('I\'m the workspace lead. Whenever you\'re ready, I can help set this up.');
  // One soft chip, no starters (founder, 2026-10-08).
  await expect(intro.getByRole('button')).toHaveCount(1);
  await expect(intro.getByRole('button', { name: 'Set up this workspace' })).toBeVisible();
  await expect(page.getByText(/Apply a workspace|Teams & agents/)).toHaveCount(0);

  // The checklist sits where the invite box did, every tick read from the
  // workspace. (Inviting someone may already be done: it counts anyone else
  // in the Org, and a dev database has other people in it. So may "Make it
  // yours": the Org's brand is the Org's, not this workspace's.)
  await expect(page.getByTestId('getting-started-count')).toHaveText(/^Getting started · [0-2] of 5$/);

  await page.getByRole('button', { name: /Getting started/ }).click();

  for (const step of ['connect', 'app', 'hire']) {
    await expect(page.getByTestId(`getting-started-${step}`)).toHaveAttribute('data-done', 'false');
  }

  await expect(page.getByText('Invite team members')).toHaveCount(0);

  await shot(page, '01-lead-intro');
});

test('the lead interviews, proposes the plan as one-click cards, and each runs as the person\'s action with Undo', async ({ page }) => {
  await openChat(page);
  await page.getByTestId('lead-intro').getByRole('button', { name: 'Set up this workspace' }).click();

  await expect(page.getByText('what does this team do?')).toBeVisible({ timeout: 120_000 });

  await shot(page, '02-first-question');

  await say(page, 'We run customer support for a software product.');

  await expect(page.getByText('Name one job you do every week')).toBeVisible({ timeout: 120_000 });

  await say(page, 'Every Friday we report on open tickets.');

  await expect(page.getByText('which systems does the work live in?')).toBeVisible({ timeout: 120_000 });

  await say(page, 'GitHub. Ana should be here too: ana@northwind.example');

  const plan = page.getByTestId('setup-plan');

  await expect(plan).toBeVisible({ timeout: 120_000 });
  await expect(plan.getByTestId('setup-card')).toHaveCount(3);
  await expect(plan).toContainText('Add Software Factory');
  await expect(plan).toContainText('Connect GitHub');
  await expect(plan).toContainText('Hire Reporting Analyst');
  await expect(plan).toContainText('Invite ana@northwind.example');
  await expect(plan).toContainText('Owns the Friday report on open tickets.');

  await shot(page, '03-setup-plan');

  // Each card runs as the person's action, with Undo, and the checklist counts it.
  const app = plan.getByTestId('setup-card').filter({ hasText: 'Add Software Factory' });
  await app.getByRole('button', { name: 'Add' }).click();

  await expect(app).toHaveAttribute('data-step-state', 'done', { timeout: 60_000 });
  await expect(app.getByTestId('setup-card-undo')).toBeVisible();
  await expect(app.getByTestId('setup-card-open')).toHaveText('Open Software Factory');
  await expect(page.getByTestId('getting-started-app')).toHaveAttribute('data-done', 'true');

  const hire = plan.getByTestId('setup-card').filter({ hasText: 'Hire Reporting Analyst' });
  await hire.getByRole('button', { name: 'Hire' }).click();

  await expect(hire).toHaveAttribute('data-step-state', 'done', { timeout: 60_000 });

  const invite = plan.getByTestId('setup-card').filter({ hasText: 'Invite ana@northwind.example' });
  await invite.getByRole('button', { name: 'Invite' }).click();

  await expect(invite).toHaveAttribute('data-step-state', 'done', { timeout: 60_000 });
  await expect(page.getByTestId('getting-started-hire')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('getting-started-invite')).toHaveAttribute('data-done', 'true');

  // "Make it yours" counts the Org's brand, which this run does not touch.
  const branded = (await page.getByTestId('getting-started-brand').getAttribute('data-done')) === 'true' ? 1 : 0;

  await expect(page.getByTestId('getting-started-count')).toHaveText(`Getting started · ${3 + branded} of 5`);

  await shot(page, '04-steps-done');

  // Undo is one move from where it says Done, and the checklist follows.
  await app.getByTestId('setup-card-undo').click();

  await expect(app).toHaveAttribute('data-step-state', 'undone', { timeout: 60_000 });
  await expect(page.getByTestId('getting-started-app')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('getting-started-count')).toHaveText(`Getting started · ${2 + branded} of 5`);

  // A reload draws each step as what it became, not as a button again — once
  // the server has finished writing the turns down (their rows are `running`
  // until then, and a reload in that window says "Still answering…").
  await expect.poll(async () => {
    await page.reload();

    await expect(page.getByTestId('setup-plan')).toBeVisible({ timeout: 60_000 });

    return page.getByText('Still answering…').count();
  }, { timeout: 90_000, intervals: [1_000, 2_000, 5_000] }).toBe(0);

  await expect(page.getByTestId('setup-card').filter({ hasText: 'Hire Reporting Analyst' })).toHaveAttribute('data-step-state', 'done', { timeout: 60_000 });
  await expect(page.getByTestId('setup-card').filter({ hasText: 'Add Software Factory' })).toHaveAttribute('data-step-state', 'undone');

  await shot(page, '05-after-reload');
});
