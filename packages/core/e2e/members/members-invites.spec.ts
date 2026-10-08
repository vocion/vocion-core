import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * Invites on the Members page: somebody invited and not yet joined is a row on
 * the People lane beside the people who have, counted in the summary,
 * narrowed by Status, and revoked from the row — and only the session's own
 * Org's invites ever show.
 *
 * Fixtures come from `support/seed-members-fixtures.ts`: an admin and a member
 * in "E2E Members", two invites the admin sent (one open, one expired), and a
 * second Org with an invite of its own. Nobody is in two Orgs, so this runs on
 * a default single-Org server.
 */

const SEED_SCRIPT = 'e2e/members/support/seed-members-fixtures.ts';
// Must match the seed script. Duplicated rather than imported because
// importing the script would run it.
const ADMIN = { email: 'members-admin@e2e-members.example', password: 'members-e2e-pass-1' };
const COLLEAGUE = 'Members Colleague';
const OPEN_INVITE = 'casey@northwind.example';
const EXPIRED_INVITE = 'devon@northwind.example';
const ELSEWHERE_INVITE = 'erin@acme.example';

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

test('an admin sees who is invited on Members, only for their Org, and can revoke an invite', async ({ page }) => {
  seedFixtures();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  await page.goto('/dashboard/members');

  const open = page.locator('[data-testid^="invite-row-"]').filter({ hasText: OPEN_INVITE });
  const lapsed = page.locator('[data-testid^="invite-row-"]').filter({ hasText: EXPIRED_INVITE });

  // Both invites are rows beside the Org's two people, counted in the summary.
  await expect(open).toContainText('by Members Admin');
  await expect(open.getByTestId('invite-state')).toHaveText('Invited');
  await expect(lapsed.getByTestId('invite-state')).toHaveText('Expired');
  await expect(page.getByText('2 people · 2 invited')).toBeVisible();

  // Another Org's invite never shows here.
  await expect(page.getByText(ELSEWHERE_INVITE)).toHaveCount(0);

  // Status narrows the lane to the invites.
  await page.getByRole('combobox', { name: 'Status' }).selectOption('invited');

  await expect(page.getByText('2 invited', { exact: true })).toBeVisible();
  await expect(page.getByText(COLLEAGUE)).toHaveCount(0);

  // Revoking asks first, then the row goes.
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: `Actions for the invite to ${OPEN_INVITE}` }).click();
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click();

  await expect(open).toHaveCount(0);
  await expect(page.getByText('1 invited', { exact: true })).toBeVisible();
});
