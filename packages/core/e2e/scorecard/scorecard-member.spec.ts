import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';

/**
 * #342 — the agent scorecard, as a client's non-admin member sees it.
 *
 * The first spec that signs in as a MEMBER rather than an admin, because that
 * is the promise: a business user opens this on their own. It is also the
 * first real check that the agreement rate renders in the UI at all.
 *
 * Fixtures come from `support/seed-scorecard-fixtures.ts`: a member user in
 * its own account, an agent with three decided recommendations (2 agreed,
 * confidences 0.9 / 0.8 / 0.7) and an agent with none.
 */

const SEED_SCRIPT = 'e2e/scorecard/support/seed-scorecard-fixtures.ts';
// Must match the seed script. Duplicated rather than imported because
// importing the script would run it.
const MEMBER = { email: 'scorecard-member@e2e.test', password: 'scorecard-e2e-pass-1' };
const DECIDED_AGENT = { slug: 'e2e-screener', name: 'E2E Applicant Screener' };
const UNDECIDED_AGENT = { slug: 'e2e-router', name: 'E2E Store Router' };

/** Zero-based cells in a scorecard row: agent, agreement, average confidence, people, conversations, reviewed, accepted as-is. */
const AGREEMENT_CELL = 1;
const CONFIDENCE_CELL = 2;

function seedFixtures(): void {
  // Through `dotenv -c` so the script sees .env.local, same as the app under test.
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

test('a non-admin member reaches the scorecard from the main nav and sees every agent, with "Not enough data" for one nobody has judged', async ({ page }) => {
  seedFixtures();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(MEMBER.email);
  await page.getByLabel('Password', { exact: true }).fill(MEMBER.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard/);

  // Reachable from the WORK nav a member sees — not from the admin-only manage menu.
  await page.getByRole('link', { name: 'Scorecard' }).first().click();
  await page.waitForURL(/\/dashboard\/scorecard/);

  const decidedRow = page.locator(`[data-testid="scorecard-row"][data-agent-slug="${DECIDED_AGENT.slug}"]`);
  const undecidedRow = page.locator(`[data-testid="scorecard-row"][data-agent-slug="${UNDECIDED_AGENT.slug}"]`);

  // The table is client-fetched: wait for the rows, not the loading line.
  await expect(decidedRow).toBeVisible();
  await expect(page.getByTestId('scorecard-row')).toHaveCount(2);

  await expect(decidedRow.getByRole('cell').first()).toHaveText(DECIDED_AGENT.name);
  await expect(decidedRow.getByRole('cell').nth(AGREEMENT_CELL)).toHaveText('67%');
  await expect(decidedRow.getByRole('cell').nth(CONFIDENCE_CELL)).toHaveText('80%');

  // The agent nobody has judged still has a row, and reads as no data — never 0%.
  await expect(undecidedRow.getByRole('cell').first()).toHaveText(UNDECIDED_AGENT.name);
  await expect(undecidedRow.getByRole('cell').nth(AGREEMENT_CELL)).toHaveText('Not enough data');
  await expect(undecidedRow.getByRole('cell').nth(CONFIDENCE_CELL)).toHaveText('Not enough data');
  await expect(undecidedRow).not.toContainText('0%');

  // The per-person activity log belongs to the admin Adoption page, not here.
  await expect(page.getByRole('columnheader', { name: 'Member' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Logins' })).toHaveCount(0);

  // Client-facing wording: no engineering "eval" anywhere on the page.
  await expect(page.locator('main')).not.toContainText(/eval/i);
});
