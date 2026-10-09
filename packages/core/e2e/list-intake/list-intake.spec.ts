import type { Page } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';
import { devices, expect, test } from '@playwright/test';
import { ADMIN, seedListIntakeWorkspace } from './support/seed';

/**
 * LIST INTAKE — a pile of badges and notes dropped into chat becomes Lead
 * records, and what could not be settled is ONE Decision.
 *
 * The scripted model (`e2e/list-intake/scripts/chat.json`) plays both parts
 * that are a model's: the agent calling `extract_records`, and the reader
 * answering for each file (its lines match "File: <name>"). Everything else
 * is real: the uploads, the room, the records and their provenance, the
 * duplicate checks against a Lead on file and a CRM contact, the docked
 * Decision and the settle action its recommended option runs.
 *
 * Start the server with the scripted model (`npm run e2e:list-intake`):
 *   VOCION_LLM_PROVIDER=scripted
 *   VOCION_LLM_SCRIPT=e2e/list-intake/scripts/chat.json
 *
 * `LIST_INTAKE_SHOTS` names a directory for the screenshots (desktop and phone).
 * Fixtures are fictional: Northwind Expo 2026 and the fixture cast.
 */

const SHOTS = process.env.LIST_INTAKE_SHOTS;
const FIXTURES = path.resolve(__dirname, '..', '..', 'src', 'services', 'intake', 'fixtures');
const QUESTION = '1 unreadable · 1 already in HubSpot · 1 already on file · 1 unsure — merge?';

test.beforeAll(() => {
  seedListIntakeWorkspace();
});

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.secret);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
}

async function shot(page: Page, name: string) {
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  }
}

/**
 * Drop the fixture files into a new chat and say what they are.
 * @param page - The page, signed in.
 */
async function dropBadges(page: Page) {
  await page.goto('/dashboard/chat?new=1');
  const box = page.locator('textarea[data-agent-composer]').last();

  await expect(box).toBeVisible({ timeout: 120_000 });

  await page.getByTestId('composer-file-input').last().setInputFiles([
    'badge-jamie-smith.png',
    'badge-dana-reyes.png',
    'badge-rowan-pike.png',
    'badge-blurred.png',
    'booth-notes.txt',
  ].map(f => path.join(FIXTURES, f)));

  await expect(page.getByText('booth-notes.txt').last()).toBeVisible({ timeout: 60_000 });

  await box.click();
  await box.fill('These are the badges from Northwind Expo 2026 and my booth notes. File them as leads, I met them all.');
  await page.getByRole('button', { name: 'Send message' }).last().click();
}

test('badges dropped into chat become leads, and the rest is one Decision', async ({ page }) => {
  await signIn(page);
  await dropBadges(page);

  const card = page.getByRole('dialog', { name: QUESTION });

  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card.getByRole('option').first()).toContainText('Merge 2 into what\'s on file, add 1');
  await expect(card).toContainText('Added Jamie Smith.');

  await shot(page, 'desktop-01-decision');

  // The recommendation is preselected; Enter takes it.
  await card.getByRole('listbox').focus();
  await page.keyboard.press('Enter');

  await expect(card).toBeHidden({ timeout: 60_000 });
  await expect(page.getByText('Every lead from Northwind Expo 2026 is in.')).toBeVisible({ timeout: 120_000 });

  await shot(page, 'desktop-02-settled');
});

test.describe('on a phone', () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices['iPhone 13'];

  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test('the same drop ends at one Decision', async ({ page }) => {
    await signIn(page);
    await dropBadges(page);
    // The room the turn opened sits over the conversation on a phone; closing
    // it shows the card. Everyone is on file by now, from the first case.
    const card = page.getByRole('dialog').filter({ hasText: 'merge?' });
    const close = page.getByRole('button', { name: /^close/i }).first();

    await expect(close.or(card).first()).toBeVisible({ timeout: 120_000 });

    if (await close.isVisible().catch(() => false)) {
      await close.click();
    }

    await expect(card).toBeVisible({ timeout: 60_000 });

    await shot(page, 'phone-01-decision');
  });
});
