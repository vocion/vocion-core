import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { ADMIN, seedDecisionsWorkspace } from '../decisions/support/seed';

/**
 * A PERSONAL WORKSPACE OPENS ON ITS PERSON'S OWN ASSISTANT (founder,
 * 2026-10-09, on agents.metacto.com: "I'm not getting the nice intro warm
 * chat … I get an ugly text message asking me to go hire agents").
 *
 * Starts from the state found on that box: the Personal workspace's lead
 * names `assistant` and no assistant row exists. Asserted on a phone:
 * - opening chat heals it: the warm start, one avatar, "Hi Dana — I'm your
 *   personal assistant on Metacto.", and starters fitted to what is connected;
 * - never "no agents yet", never a link to go hire;
 * - no "Invite team members" card in the drawer;
 * - once named "Ziggy": "Hi Dana — I'm Ziggy." and "Ask Ziggy…".
 *
 * Run with the scripted model (`npm run e2e:objectives`). `PERSONAL_SHOTS`
 * names a directory for the screenshots. Fixtures are fictional.
 */

const SHOTS = process.env.PERSONAL_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.beforeAll(() => {
  seedDecisionsWorkspace();
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
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
}

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

test('a Personal workspace that lost its assistant opens on it, warm, with starters and no invite card', async ({ page }) => {
  await signIn(page);
  // Signing in ensures the Personal workspace; then the state from the box:
  // its lead names `assistant`, and no row is behind it.
  const [home] = await sql<{ id: string; slug: string }>(`SELECT p.id, p.slug FROM project p JOIN "user" u ON u.id = p.owner_user_id WHERE p.kind = 'personal' AND u.email = $1 LIMIT 1`, [ADMIN.email]);

  expect(home).toBeTruthy();

  await sql(`DELETE FROM agent WHERE org_id = $1`, [home!.id]);
  await sql(`UPDATE project SET lead_agent_slug = 'assistant' WHERE id = $1`, [home!.id]);

  await page.goto(`/w/${home!.slug}/dashboard/chat?new=1`);
  const intro = page.getByTestId('lead-intro');

  await expect(intro).toBeVisible({ timeout: 60_000 });
  await expect(intro).toHaveAttribute('data-personal', 'true');
  await expect(intro).toContainText(/Hi Dana — I'm your personal assistant on Metacto\./);
  await expect(page.getByText(/no agents yet|Hire one/i)).toHaveCount(0);
  await expect(page.getByTestId('no-agents-state')).toHaveCount(0);

  // Starters fitted to a Personal workspace with nothing connected.
  const hints = page.getByTestId('opening-hint-label');

  await expect(hints.first()).toBeVisible();
  await expect(hints).toContainText([/What's waiting on me across Metacto\?/]);
  await expect(page.locator('textarea').last()).toHaveAttribute('placeholder', 'Ask your assistant…');
  // Healed for good: the row is there now.
  expect(await sql(`SELECT slug FROM agent WHERE org_id = $1`, [home!.id])).toEqual([{ slug: 'assistant' }]);

  await shot(page, '1-personal-warm-start');

  // The drawer: no team invite in a person's own workspace.
  await page.getByRole('button', { name: /Toggle Sidebar/i }).first().tap();

  await expect(page.getByText('Manage workspace').last()).toBeVisible();
  await expect(page.getByText('Invite team members')).toHaveCount(0);

  // Let the drawer finish sliding in before the picture.
  await page.waitForTimeout(500);
  await shot(page, '2-personal-drawer');

  // Named, it is that name.
  await sql(`UPDATE agent SET name = 'Ziggy' WHERE org_id = $1 AND slug = 'assistant'`, [home!.id]);
  await page.goto(`/w/${home!.slug}/dashboard/chat?new=1`);

  await expect(page.getByTestId('lead-intro')).toContainText('Hi Dana — I\'m Ziggy.', { timeout: 60_000 });
  await expect(page.locator('textarea').last()).toHaveAttribute('placeholder', 'Ask Ziggy…');

  await shot(page, '3-personal-named');
});
