import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * GOALS, in the app. Seeded by `support/seed-goals-fixtures.ts` (fictional:
 * Northwind Trading's GTM and Partners workspaces, Robin Vale's goals, a
 * teammate's): the workspace list through the shared list pieces, a goal's
 * page counted live from its view, Pause and Resume, a milestone ticked by
 * hand, and "Your goals" in Personal, each labelled with where it lives.
 */

const SEED_SCRIPT = 'e2e/goals/support/seed-goals-fixtures.ts';
const PERSON = { email: 'goals@e2e.example', password: 'goals-e2e-pass-1' };
const GTM = '/w/e2e-goals-gtm/dashboard/goals';

test.describe.configure({ mode: 'serial' });

let page: Page;
let personalSlug = '';

test.beforeAll(async ({ browser }) => {
  const out = execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  personalSlug = (JSON.parse(out.trim().split('\n').at(-1)!) as { personalSlug: string }).personalSlug;
  page = await browser.newPage();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(PERSON.email);
  await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);
});

test.afterAll(async () => {
  await page.close();
});

test('a workspace lists its goals: the person\'s own by default, everyone\'s a chip away', async () => {
  await page.goto(GTM);
  const rows = page.getByTestId('goal-row');

  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Follow up with Northwind Expo contacts');
  await expect(rows.first()).toContainText('12 of 40');

  await page.getByRole('button', { name: /Everyone/ }).first().click();

  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('goals-list')).toContainText('Sam Okafor');
});

test('a goal\'s page counts its view live, proposes next steps as pills, and pauses', async () => {
  await page.goto(GTM);
  await page.getByTestId('goal-row').filter({ hasText: 'Northwind Expo' }).click();

  await expect(page.getByTestId('goal-page')).toBeVisible();
  await expect(page.getByTestId('goal-progress-section')).toContainText('12 of 40 contacted');
  await expect(page.getByTestId('goal-progress-section')).toContainText('never ticked by hand');
  await expect(page.getByTestId('goal-next-step')).toHaveCount(2);
  await expect(page.getByTestId('goal-links')).toContainText('Expo follow-up plan');

  await page.getByTestId('goal-pause').click();

  await expect(page.getByTestId('goal-resume')).toBeVisible();

  await page.getByTestId('goal-resume').click();

  await expect(page.getByTestId('goal-pause')).toBeVisible();
});

test('a milestone ticked by hand moves the goal and says so', async () => {
  await page.goto(GTM);
  await page.getByTestId('goal-row').filter({ hasText: 'Expand vertical GTM strategy' }).click();

  await expect(page.getByTestId('goal-progress-section')).toContainText('2 of 5 milestones');

  await page.getByRole('button', { name: 'Mark done: Write the vertical playbook' }).click();

  await expect(page.getByTestId('goal-progress-section')).toContainText('3 of 5 milestones');
  await expect(page.getByTestId('goal-activity')).toContainText('Done: Write the vertical playbook');
});

test('Personal lists your goals across your workspaces, each with where it lives', async () => {
  await page.goto(`/w/${personalSlug}/dashboard/goals`);
  const list = page.getByTestId('goals-list');

  await expect(page.getByRole('heading', { name: 'Your goals' })).toBeVisible();
  await expect(page.getByTestId('goal-row')).toHaveCount(5);
  await expect(list).toContainText('Read two books on referral programs');
  await expect(page.getByTestId('goal-row').filter({ hasText: 'Activate referral partners' })).toContainText('Partners');
  await expect(page.getByTestId('goal-row').filter({ hasText: 'Activate referral partners' })).toContainText(/quiet \d+ days/);
  await expect(page.getByTestId('goal-row').filter({ hasText: 'Northwind Expo' })).toContainText('GTM');
  // Someone else's goal is never in your list.
  await expect(list).not.toContainText('Bellwater Hall');
});
