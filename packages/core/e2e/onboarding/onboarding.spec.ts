import type { Page } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedOnboarding } from './support/seed';

/**
 * A new workspace, set up by chat: it opens on its lead, the lead interviews
 * (three questions) and proposes a plan as setup steps docked above the
 * composer, one at a time; each step the person takes runs as their action,
 * with Undo, while the sidebar's Getting started checklist counts it.
 *
 * The model is scripted (`scripts/chat.json`): it really calls `setup_options`
 * and `propose_setup`, so the steps, the actions behind them, the undo and the
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

test('the lead interviews, proposes the plan as docked setup steps, and each runs as the person\'s action with Undo', async ({ page }) => {
  await openChat(page);
  await page.getByTestId('lead-intro').getByRole('button', { name: 'Set up this workspace' }).click();

  await expect(page.getByText('what does this team do?')).toBeVisible({ timeout: 120_000 });

  await shot(page, '02-first-question');

  await say(page, 'We run customer support for a software product.');

  await expect(page.getByText('Name one job you do every week')).toBeVisible({ timeout: 120_000 });

  await say(page, 'Every Friday we report on open tickets.');

  await expect(page.getByText('which systems does the work live in?')).toBeVisible({ timeout: 120_000 });

  await say(page, 'GitHub. Ana should be here too: ana@northwind.example');

  // The plan is a queue of setup steps docked above the composer, one at a
  // time, each saying why — the same Decision every other ask is.
  const dock = page.getByTestId('decision-dock');
  const step = (name: string) => dock.getByRole('dialog', { name });
  const idle = () => expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });

  await expect(step('Add Software Factory')).toBeVisible({ timeout: 120_000 });
  await expect(dock.getByTestId('decision-queue')).toHaveText(/1 of 4/);
  await expect(dock).toContainText('Customer requests become fixes the asker hears about.');

  await idle();

  await shot(page, '03-setup-plan');

  // Enter takes the step: it runs as the person's action, with Undo, and the
  // checklist counts it.
  await step('Add Software Factory').getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  const added = page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Add Software Factory' });

  await expect(added).toBeVisible({ timeout: 60_000 });
  await expect(added.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByTestId('getting-started-app')).toHaveAttribute('data-done', 'true');

  await idle();

  // Connecting is a step too; not now — Skip leaves it, nothing runs.
  await expect(step('Connect GitHub')).toBeVisible();

  await step('Connect GitHub').getByTestId('decision-skip').click();
  await idle();

  await expect(step('Hire Reporting Analyst')).toBeVisible({ timeout: 60_000 });
  await expect(step('Hire Reporting Analyst')).toContainText('Owns the Friday report on open tickets.');

  await step('Hire Reporting Analyst').getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  // The next step is taken as soon as it shows — while the agent may still be
  // replying to the last: the answer is held and goes when that turn lands.
  await expect(step('Invite ana@northwind.example')).toBeVisible({ timeout: 60_000 });

  await step('Invite ana@northwind.example').getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Hire Reporting Analyst' })).toBeVisible({ timeout: 60_000 });

  await expect(page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Invite ana@northwind.example' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('getting-started-hire')).toHaveAttribute('data-done', 'true');
  await expect(page.getByTestId('getting-started-invite')).toHaveAttribute('data-done', 'true');

  // "Make it yours" counts the Org's brand, which this run does not touch.
  const branded = (await page.getByTestId('getting-started-brand').getAttribute('data-done')) === 'true' ? 1 : 0;

  await expect(page.getByTestId('getting-started-count')).toHaveText(`Getting started · ${3 + branded} of 5`);
  await expect(dock).toHaveCount(0);

  await idle();

  await shot(page, '04-steps-done');

  // Undo is one move from where it says Done, and the checklist follows.
  await added.getByRole('button', { name: 'Undo' }).click();

  await expect(added).toContainText('Undone', { timeout: 60_000 });
  await expect(page.getByTestId('getting-started-app')).toHaveAttribute('data-done', 'false');
  await expect(page.getByTestId('getting-started-count')).toHaveText(`Getting started · ${2 + branded} of 5`);

  // A reload draws each step as what it became, not as a button again.
  await page.reload();

  await expect(page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Hire Reporting Analyst' })).toContainText('Done', { timeout: 60_000 });
  await expect(page.getByTestId('done-receipts').locator('li').filter({ hasText: 'Add Software Factory' })).toContainText('Undone');
  await expect(page.getByTestId('decision-dock')).toHaveCount(0);

  await shot(page, '05-after-reload');
});
