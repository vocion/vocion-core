import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../../tests/TestUtils';

/**
 * #343 — the eval section, once runs can come from more than one grader.
 *
 * Three states the design promised and the code has to keep getting right:
 *
 * - A dataset with no runs says so. It must never read as 0% — "nobody has
 *   measured this" and "it fails everything" are opposite facts.
 * - With one grader, the grader is still named but there is no filter, and an
 *   org that has never used AgentCore sees no sign that it exists.
 * - With two graders, the filter appears, labels each run, and filtering
 *   really narrows the list rather than just highlighting a pill.
 *
 * Plus the fourth thing the design asked for: the eval pass rate sitting
 * beside the agreement rate on the agent's adoption row.
 *
 * Self-seeding, like the credentials spec: a fresh dev database has no users,
 * so this bootstraps the admin with `create-local-user.ts` (the signup route
 * is invite-only) and writes its own rows. No agent is ever run and no model
 * is ever called — every run row is written already finished.
 *
 * Run with: npx playwright test --project=evals-providers
 */

const ADMIN = {
  name: 'Eval Provider Tester',
  account: 'Eval Provider Co',
  email: 'eval-providers@example.test',
  password: 'eval-providers-e2e-1',
};

type SeedFixtures = {
  orgId: string;
  agentSlug: string;
  untouchedSlug: string;
  oneGraderSlug: string;
  twoGradersSlug: string;
};

function createBootstrapAdmin(): void {
  try {
    // Through `dotenv -c` so the script sees .env.local — it runs outside the
    // Next process, which is the only thing that loads that file on its own.
    execFileSync(
      'npx',
      [
        'dotenv',
        '-c',
        '--',
        'npx',
        'tsx',
        'src/scripts/create-local-user.ts',
        '--email',
        ADMIN.email,
        '--name',
        ADMIN.name,
        '--account',
        ADMIN.account,
        '--password',
        ADMIN.password,
        '--role',
        'admin',
      ],
      { stdio: ['ignore', 'inherit', 'pipe'] },
    );
  } catch (error) {
    tolerateExistingUser(error, '[evals-providers spec]');
  }
}

function seedFixtures(): SeedFixtures {
  try {
    const output = execFileSync(
      'npx',
      [
        'dotenv',
        '-c',
        '--',
        'npx',
        'tsx',
        'e2e/evals-providers/support/seed-eval-provider-fixtures.ts',
        '--email',
        ADMIN.email,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output.trim().split('\n').at(-1) ?? '') as SeedFixtures;
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    process.stderr.write(stderr);
    throw new Error(`could not seed eval provider fixtures: ${stderr.trim().split('\n').at(-1) ?? String(error)}`);
  }
}

/**
 * Text a person can actually read on the page.
 *
 * Next streams `<title>` into the body, and every eval page titles itself with
 * the same "80% pass" text it shows in the run list — so a plain `getByText`
 * matches twice and trips strict mode. Keeping only the visible matches asserts
 * on what someone looking at the screen would see, which is what these tests
 * are about.
 * @param page - The page under test.
 * @param text - What to look for.
 * @param options - Passed through to `getByText`, e.g. `{ exact: true }`.
 * @param options.exact - Match the whole text node rather than a substring.
 */
function shownText(page: Page, text: string | RegExp, options?: { exact?: boolean }) {
  return page.getByText(text, options).filter({ visible: true });
}

/**
 * Sign in as the bootstrap admin.
 * @param page - A fresh page.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard**');
}

let fixtures: SeedFixtures;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  createBootstrapAdmin();
  fixtures = seedFixtures();
});

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe('the eval section, with more than one grader', () => {
  test('the list dates every dataset, so stale ones show without opening them', async ({ page }) => {
    await page.goto('/dashboard/evals');

    const untouchedCard = page.getByRole('listitem').filter({ hasText: fixtures.untouchedSlug });
    const oneGraderCard = page.getByRole('listitem').filter({ hasText: fixtures.oneGraderSlug });

    // Never run is a fact about measurement, not a score of zero.
    await expect(untouchedCard).toContainText('never run');
    await expect(oneGraderCard).toContainText('last run');
    await expect(oneGraderCard).toContainText('80% pass');
  });

  test('a dataset nobody has run says so, rather than showing zero', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.untouchedSlug}`);

    await expect(shownText(page, 'No runs yet', { exact: false })).toBeVisible();
    // The distinction this test exists for.
    await expect(shownText(page, '0% pass')).toHaveCount(0);
  });

  test('one grader is still named, but there is nothing to filter', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.oneGraderSlug}`);

    await expect(shownText(page, '80% pass')).toBeVisible();
    // Who scored it is always said, because it is what makes the number mean
    // something.
    await expect(shownText(page, 'Vocion', { exact: true }).first()).toBeVisible();
    // Nothing to choose between, so nothing to choose from — and an org that
    // has never touched AWS sees no sign AgentCore exists.
    await expect(page.getByRole('link', { name: 'All', exact: true })).toHaveCount(0);
    await expect(shownText(page, 'AgentCore')).toHaveCount(0);
  });

  test('two graders are labelled, and the filter really narrows the list', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.twoGradersSlug}`);

    await expect(page.getByRole('link', { name: 'All', exact: true })).toBeVisible();
    await expect(shownText(page, '90% pass')).toBeVisible();
    await expect(shownText(page, '70% pass')).toBeVisible();

    await page.getByRole('link', { name: 'AgentCore', exact: true }).click();
    await page.waitForURL('**/dashboard/evals/**provider=agentcore');

    // Only AgentCore's runs survive the filter — Vocion's 90% is gone.
    await expect(shownText(page, '70% pass')).toBeVisible();
    await expect(shownText(page, '90% pass')).toHaveCount(0);
  });

  test('the trend chart marks where the dataset changed underneath the scores', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.twoGradersSlug}`);

    await expect(shownText(page, 'Pass rate over time')).toBeVisible();
    // Says which version, not just that something happened.
    await expect(shownText(page, 'dataset edited (now v2)', { exact: false })).toBeVisible();
  });

  test('the agent\'s adoption row shows its eval pass rate beside agreement', async ({ page }) => {
    await page.goto(`/dashboard/adoption/agents/${fixtures.agentSlug}`);

    await expect(shownText(page, 'Agreement', { exact: true })).toBeVisible();

    // Scoped to its own card: another stat on this row could legitimately read
    // 70% too, and then a page-wide text match would be measuring the wrong
    // number, or failing on strict mode for the wrong reason.
    const evalCard = page.locator('div').filter({ hasText: /^70%Eval pass rate/ }).first();

    await expect(evalCard).toBeVisible();
    // The newest finished run for this agent from its first grader by name,
    // which is AgentCore's 70% rather than Vocion's 90% on the same dataset.
    await expect(evalCard).toContainText('e2e-two-graders');
  });
});
