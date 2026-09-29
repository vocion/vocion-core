import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * vocion-core#128 — a person in two accounts switches account by switching
 * workspace, and the account sticks.
 *
 * Fixtures come from `support/seed-account-switch-fixtures.ts`: one person in
 * "E2E Switch First" (joined first) and "E2E Switch Second", a `Switch Home`
 * workspace on First, and a workspace with the SAME slug, `e2e-switch-shared`,
 * on each account, plus one colleague per account. The switcher's trigger
 * shows the active workspace's name over its account's name, and the Members
 * page lists the session account's people; all three come from the session's
 * tenancy, so they are what this spec reads.
 */

const SEED_SCRIPT = 'e2e/account-switch/support/seed-account-switch-fixtures.ts';
// Must match the seed script. Duplicated rather than imported because
// importing the script would run it.
const PERSON = { email: 'switch-person@e2e.test', password: 'account-switch-e2e-pass-1' };
const FIRST_ACCOUNT = 'E2E Switch First';
const SECOND_ACCOUNT = 'E2E Switch Second';
const FIRST_COLLEAGUE = 'First Colleague';
const SECOND_COLLEAGUE = 'Second Colleague';

function seedFixtures(): void {
  // Through `dotenv -c` so the script sees the same env files as the app under test.
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr) {
      process.stderr.write(stderr);
    }
    const reason = stderr.trim().split('\n').at(-1) || (error instanceof Error ? error.message : String(error));
    throw new Error(`${SEED_SCRIPT} failed: ${reason}`);
  }
}

/**
 * The sidebar's switcher button. The sidebar mounts one per layout, so take
 * the one on screen.
 * @param page - The signed-in page.
 */
function switcher(page: Page) {
  return page.getByRole('button', { name: 'Switch workspace' }).filter({ visible: true });
}

/**
 * Open the switcher and pick a workspace under one account's heading.
 * @param page - The signed-in page.
 * @param account - The account heading to pick under.
 * @param workspace - The workspace name to click.
 */
async function switchTo(page: Page, account: string, workspace: string): Promise<void> {
  await switcher(page).click();
  await page.getByRole('group', { name: account }).getByRole('option', { name: new RegExp(workspace) }).click();
}

test('switching to a workspace on another account moves the whole session there, and it survives a bare /dashboard link', async ({ page }) => {
  seedFixtures();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(PERSON.email);
  await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Nothing has picked a workspace in this browser yet: the account joined
  // first, and its oldest workspace.
  await page.waitForURL(/\/w\/e2e-switch-home\/dashboard/);

  await expect(switcher(page)).toContainText('Switch Home');
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);

  // The same slug lives on both accounts. Picking the one under Second must
  // open Second's, not First's.
  await switchTo(page, SECOND_ACCOUNT, 'Shared In Second');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard.*account=e2e-switch-second/);

  await expect(switcher(page)).toContainText('Shared In Second');
  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // A reload keeps them there.
  await page.reload();

  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // A bare link carries no workspace and no account: "last active" must keep
  // them in Second, and the shared slug must resolve there too.
  await page.goto('/dashboard');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard/);

  expect(page.url()).not.toContain('account=');
  await expect(switcher(page)).toContainText('Shared In Second');
  await expect(switcher(page)).toContainText(SECOND_ACCOUNT);

  // The rest of the dashboard moved too: Members lists Second's people, not First's.
  await page.goto('/dashboard/members');

  await expect(page.getByText(SECOND_COLLEAGUE)).toBeVisible();
  await expect(page.getByText(FIRST_COLLEAGUE)).toHaveCount(0);

  // And back across to First's copy of the same slug.
  await switchTo(page, FIRST_ACCOUNT, 'Shared In First');
  await page.waitForURL(/\/w\/e2e-switch-shared\/dashboard.*account=e2e-switch-first/);

  await expect(switcher(page)).toContainText('Shared In First');
  await expect(switcher(page)).toContainText(FIRST_ACCOUNT);
  // The switch kept the Members page, now listing First's people.
  await expect(page.getByText(FIRST_COLLEAGUE)).toBeVisible();
  await expect(page.getByText(SECOND_COLLEAGUE)).toHaveCount(0);
});
