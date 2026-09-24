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
 * Plus where the cases themselves live: a grader that keeps its own copy of
 * them can be holding older ones than the workspace file does, and the page
 * has to say which without making an out-of-date copy look like a broken eval.
 *
 * Plus the period picker (#647): choosing a period narrows the summary, the
 * chart and the run list together, lives in the URL so a reload keeps it, and
 * a period with no runs says so.
 *
 * Plus failures being visible (#647): errored and below-threshold runs are
 * counted, marked on the chart, and one click filters the list to them.
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
  changedGradersSlug: string;
  notCopiedSlug: string;
  copyFailedSlug: string;
  inStepSlug: string;
  spreadOutSlug: string;
  failingSlug: string;
  readableSlug: string;
  switchedGraderSlug: string;
  newGraderSlug: string;
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
 * Next streams `<title>` into the body, and an eval page titles itself with the
 * same text it shows on the page — so a plain `getByText` matches twice and
 * trips strict mode. Keeping only the visible matches asserts
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
 * A day some way back, as the `YYYY-MM-DD` a date input takes, in the
 * browser's own timezone — which Playwright shares with this process.
 * @param daysBack - Whole days before today.
 */
function localDay(daysBack: number): string {
  const date = new Date(Date.now() - daysBack * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/*
 * The four functions below run inside the browser through `page.evaluate` or
 * `addInitScript`, so each is self-contained: they read the browser's own
 * timezone, which a `timezoneId` test can set apart from this process's.
 */

/**
 * Whether an instant is midnight on the browser's clock.
 * @param iso - An ISO timestamp from the page's URL.
 */
function isLocalMidnight(iso: string): boolean {
  const date = new Date(iso);
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

/**
 * A day some way back as `YYYY-MM-DD`, on the browser's clock.
 * @param daysBack - Whole days before today.
 */
function browserLocalDay(daysBack: number): string {
  const date = new Date(Date.now() - daysBack * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The browser-local `YYYY-MM-DD` an instant falls on.
 * @param iso - An ISO timestamp.
 */
function browserLocalDayOf(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Choose the dark theme before the page loads; next-themes reads `theme` from localStorage. */
function storeDarkTheme(): void {
  localStorage.setItem('theme', 'dark');
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
  test('the list dates every dataset and labels every number', async ({ page }) => {
    await page.goto('/dashboard/evals');

    const untouchedCard = page.getByRole('list', { name: 'Eval datasets' }).getByRole('listitem').filter({ hasText: fixtures.untouchedSlug });
    const oneGraderCard = page.getByRole('list', { name: 'Eval datasets' }).getByRole('listitem').filter({ hasText: fixtures.oneGraderSlug });

    // Never run is a fact about measurement, not a score of zero.
    await expect(untouchedCard).toContainText('never run');
    await expect(untouchedCard).toContainText('not scored yet');
    // Every number says what it is, rather than leaving the reader to work it
    // out from the units.
    await expect(oneGraderCard).toContainText('Last run');
    await expect(oneGraderCard).toContainText('Pass rate');
    await expect(oneGraderCard).toContainText('80%');
    await expect(oneGraderCard).toContainText('Runs');
    await expect(oneGraderCard).toContainText('2');
  });

  test('searching the list narrows it to what was asked for', async ({ page }) => {
    await page.goto('/dashboard/evals');
    await page.getByLabel('Search eval datasets').fill(fixtures.changedGradersSlug);
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    const cards = page.getByRole('list', { name: 'Eval datasets' }).getByRole('listitem');

    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(fixtures.changedGradersSlug);

    // A search that matches nothing says so, and says what it searched.
    await page.getByLabel('Search eval datasets').fill('nothing-matches-this');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(shownText(page, 'Nothing matches', { exact: false })).toBeVisible();
  });

  test('a dataset nobody has run says so, rather than showing zero', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.untouchedSlug}`);

    await expect(shownText(page, 'No runs yet', { exact: false })).toBeVisible();
    // The distinction this test exists for.
    await expect(shownText(page, 'Pass rate')).toHaveCount(0);
    await expect(shownText(page, '0%', { exact: true })).toHaveCount(0);
  });

  test('the grader is named once, and an org with no AWS never hears of AgentCore', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.oneGraderSlug}`);

    // Labelled, so the number is not left to be decoded from its units.
    await expect(shownText(page, 'Pass rate').first()).toBeVisible();
    await expect(shownText(page, '80%', { exact: true }).first()).toBeVisible();
    // Who scored it is always said, because it is what makes the number mean
    // something.
    await expect(shownText(page, 'Vocion', { exact: true }).first()).toBeVisible();
    // One grader per eval, so there is nothing to pick between, and a run row
    // never repeats the grader the heading already gave.
    await expect(page.getByRole('link', { name: 'All', exact: true })).toHaveCount(0);
    await expect(shownText(page, 'Graded by')).toHaveCount(0);
    await expect(shownText(page, 'AgentCore')).toHaveCount(0);
  });

  test('a dataset that changed graders says so, and flags only the older runs', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.changedGradersSlug}`);

    // The dataset's own grader, said once beside the heading.
    await expect(shownText(page, 'AgentCore', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'All', exact: true })).toHaveCount(0);
    // Both AgentCore runs are here — nothing is filtered away.
    await expect(shownText(page, '90%', { exact: true }).first()).toBeVisible();
    await expect(shownText(page, '70%', { exact: true }).first()).toBeVisible();

    // The 60% run predates the switch, so it carries its own grader rather
    // than being read as AgentCore's work.
    await expect(shownText(page, 'before this dataset changed graders', { exact: false })).toBeVisible();
    await expect(shownText(page, 'Graded by')).toHaveCount(1);
  });

  test('an AgentCore eval says its cases are copied into AWS, and whether that copy is current', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.changedGradersSlug}`);

    // The cases were published three days ago and one has been edited since,
    // so the version AWS holds is measuring something else.
    await expect(shownText(page, 'copy is behind this workspace', { exact: false })).toBeVisible();
    // Both versions, because "v7 here, v2 there" is the whole point.
    await expect(shownText(page, 'Workspace version 2', { exact: false })).toBeVisible();
    // The id support needs to find the dataset in the AWS console.
    await expect(shownText(page, 'ds-e2e-fixture', { exact: false })).toBeVisible();
  });

  test('an AgentCore eval that has never been published says so, rather than reading as failed', async ({ page }) => {
    // Every AgentCore dataset that predates publishing looks like this, so it
    // has to render as pending rather than as an error or an empty panel.
    await page.goto(`/dashboard/evals/${fixtures.notCopiedSlug}`);

    await expect(shownText(page, 'Not copied to AgentCore yet', { exact: false })).toBeVisible();
    await expect(shownText(page, 'Could not copy', { exact: false })).toHaveCount(0);
  });

  test('a copy AWS refused says so, and says the run was still scored', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.copyFailedSlug}`);

    // The distinction the whole panel exists for: the copy failed, the
    // measurement did not.
    await expect(shownText(page, 'Could not copy these cases to AgentCore', { exact: false })).toBeVisible();
    await expect(shownText(page, 'Rate exceeded.', { exact: false })).toBeVisible();
    await expect(shownText(page, 'Runs still go ahead and are still scored', { exact: false })).toBeVisible();
    // A failed attempt must not read as a successful copy.
    await expect(shownText(page, 'last attempt', { exact: false })).toBeVisible();
    await expect(shownText(page, 'last copied', { exact: false })).toHaveCount(0);
  });

  test('a copy that is current says so without claiming anything else', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.inStepSlug}`);

    await expect(shownText(page, 'In step with AgentCore', { exact: false })).toBeVisible();
    await expect(shownText(page, 'ds-e2e-in-step', { exact: false })).toBeVisible();
    await expect(shownText(page, 'behind this workspace', { exact: false })).toHaveCount(0);
  });

  test('a Vocion eval is not offered a copy it will never have', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.oneGraderSlug}`);

    await expect(shownText(page, 'stored in Vocion', { exact: false })).toBeVisible();
    await expect(shownText(page, 'Not copied', { exact: false })).toHaveCount(0);
  });

  test('the trend chart marks where the dataset changed underneath the scores', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.changedGradersSlug}`);

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
    // which is AgentCore's 70% rather than Vocion's 80% on the other dataset.
    await expect(evalCard).toContainText('e2e-changed-graders');
  });

  test('a period narrows the summary and the run list together, and survives a reload', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);
    const summary = page.getByTestId('eval-period-summary');

    await expect(page.getByTestId('eval-period-label')).toHaveText('All time');
    await expect(summary).toContainText('4');
    await expect(summary).toContainText('60%');

    await page.getByLabel('Period', { exact: true }).selectOption('last7');
    await page.waitForURL(/period=last7/);

    // 0.9 and 0.7 are the only runs this week: two runs, averaging 80%.
    await expect(summary).toContainText('80%');
    await expect(summary).toContainText('2 runs ·');
    await expect(page.getByRole('heading', { name: 'Runs in this period' })).toBeVisible();
    await expect(page.locator('a[href*="/runs/"]')).toHaveCount(2);

    await page.reload();

    await expect(page.getByLabel('Period', { exact: true })).toHaveValue('last7');
    await expect(summary).toContainText('80%');
  });

  test('a custom range narrows to its days, and an empty one says so', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);

    // Only the run from 20 days ago falls between 25 and 15 days back.
    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await page.getByLabel('From', { exact: true }).fill(localDay(25));
    await page.getByLabel('To', { exact: true }).fill(localDay(15));
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/period=custom/);

    await expect(page.getByTestId('eval-period-summary')).toContainText('50%');
    await expect(page.locator('a[href*="/runs/"]')).toHaveCount(1);

    // A backwards range is refused in the form, before anything is fetched.
    await page.getByRole('button', { name: 'Pick a custom date range' }).click();
    await page.getByLabel('From', { exact: true }).fill(localDay(10));
    await page.getByLabel('To', { exact: true }).fill(localDay(12));
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'The end date must be on or after the start date.' })).toBeVisible();

    // Between 14 and 12 days back there are no runs at all.
    await page.getByLabel('From', { exact: true }).fill(localDay(14));
    await page.getByLabel('To', { exact: true }).fill(localDay(12));
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(shownText(page, 'No runs in this period', { exact: false })).toBeVisible();
    await expect(shownText(page, '0%', { exact: true })).toHaveCount(0);
  });

  test('errored and below-threshold runs are counted, marked, and one click away', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.failingSlug}`);

    await expect(page.getByTestId('eval-stat-Errored')).toContainText('1');
    await expect(page.getByTestId('eval-stat-Below threshold')).toContainText('1');
    // The errored run is marked on the chart, not drawn as a zero.
    await expect(page.getByTestId('eval-trend-failure')).toHaveCount(1);
    await expect(shownText(page, '80% threshold')).toBeVisible();

    await page.getByTestId('eval-stat-Errored').click();
    await page.waitForURL(/outcome=errored/);

    await expect(page.locator('a[href*="/runs/"]')).toHaveCount(1);
    await expect(shownText(page, 'failed', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Below threshold (1)' }).click();
    await page.waitForURL(/outcome=below_threshold/);

    await expect(page.locator('a[href*="/runs/"]')).toHaveCount(1);
    await expect(shownText(page, '40%', { exact: true })).toBeVisible();

    // The filter survives a period change.
    await page.getByLabel('Period', { exact: true }).selectOption('last7');
    await page.waitForURL(/period=last7/);

    expect(page.url()).toContain('outcome=below_threshold');
  });

  test('cases start collapsed and open when asked', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);
    const firstCase = page.getByTestId('eval-case').first();

    await expect(firstCase).not.toHaveAttribute('open');
    await expect(firstCase.getByText('Input', { exact: true })).toBeHidden();

    await firstCase.locator('summary').click();

    await expect(firstCase).toHaveAttribute('open');
    await expect(firstCase.getByText('Input', { exact: true })).toBeVisible();
  });

  test('Expand all opens every case and Collapse all closes them again', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.readableSlug}`);
    const cases = page.getByTestId('eval-case');

    await expect(cases).toHaveCount(3);

    await page.getByRole('button', { name: 'Expand all' }).click();
    for (const index of [0, 1, 2]) {
      await expect(cases.nth(index)).toHaveAttribute('open');
    }

    await page.getByRole('button', { name: 'Collapse all' }).click();
    for (const index of [0, 1, 2]) {
      await expect(cases.nth(index)).not.toHaveAttribute('open');
    }
  });

  test('a dataset with one case is not offered Expand all', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);

    await expect(page.getByTestId('eval-case')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Expand all' })).toHaveCount(0);
  });

  test('the evaluator breakdown gives each evaluator its latest score, average, and direction', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.readableSlug}`);
    const breakdown = page.getByTestId('evaluator-breakdown');

    await expect(breakdown).not.toHaveAttribute('open');
    await expect(breakdown).toContainText('2 evaluators');

    await breakdown.locator('summary').click();
    const judge = breakdown.getByRole('row').filter({ hasText: 'llm-judge' });
    const tone = breakdown.getByRole('row').filter({ hasText: 'tone' });

    // llm-judge went 50% then 90%; tone went 80% then 60%. Both average 70%.
    await expect(judge).toContainText('90%');
    await expect(judge).toContainText('70%');
    await expect(judge).toContainText('above its average (2 runs)');
    await expect(tone).toContainText('60%');
    await expect(tone).toContainText('below its average (2 runs)');
    // One grader ran every evaluator, so the Grader column would say nothing.
    await expect(breakdown.getByRole('columnheader', { name: 'Grader' })).toHaveCount(0);
  });
});

test.describe('a dataset that changed graders', () => {
  test('the cards and their filters count only the current grader, while All runs keeps the older one', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.switchedGraderSlug}`);
    const runLinks = page.locator('a[href*="/runs/"]');

    // Vocion's errored run and its 0.3 are left out: AgentCore has one of each kind of run.
    await expect(page.getByTestId('eval-stat-Errored').locator('p').nth(1)).toHaveText('1');
    await expect(page.getByTestId('eval-stat-Below threshold').locator('p').nth(1)).toHaveText('0');
    await expect(page.getByTestId('eval-summary-grader-note')).toContainText('count only AgentCore runs');
    await expect(runLinks).toHaveCount(4);

    await page.getByTestId('eval-stat-Errored').click();
    await page.waitForURL(/outcome=errored/);

    await expect(runLinks).toHaveCount(1);

    await page.getByRole('link', { name: 'All runs' }).click();
    await page.waitForURL(url => !url.searchParams.has('outcome'));

    await expect(runLinks).toHaveCount(4);
  });

  test('one whose new grader has not run yet still shows its history', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.newGraderSlug}`);

    await expect(page.getByRole('region', { name: 'Results for the period' })).toBeVisible();
    await expect(page.getByTestId('eval-stat-Runs').locator('p').nth(1)).toHaveText('0');
    await expect(page.getByRole('heading', { name: 'Pass rate over time' })).toBeVisible();
    await expect(page.getByTestId('eval-summary-grader-note')).toContainText('Runs scored by Vocion');
  });
});

test.describe('the eval period, for a viewer far from UTC', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });

  test('a preset starts at the viewer\'s local midnight, and the API agrees on its runs', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);
    await page.getByLabel('Period', { exact: true }).selectOption('last7');
    await page.waitForURL(/period=last7/);

    const url = new URL(page.url());
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';

    expect(await page.evaluate(isLocalMidnight, from)).toBe(true);
    expect(await page.evaluate(isLocalMidnight, to)).toBe(true);

    const response = await page.request.get(`/api/v1/evals/${fixtures.spreadOutSlug}/runs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    const body = await response.json();

    expect(response.status()).toBe(200);
    expect(body.summary.runCount).toBe(2);
    await expect(page.getByTestId('eval-period-summary')).toContainText('2 runs ·');
  });

  test('a custom range covers the viewer\'s own days, not UTC days', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);
    const today = await page.evaluate(browserLocalDay, 0);
    const lastWeek = await page.evaluate(browserLocalDay, 6);

    await page.getByLabel('Period', { exact: true }).selectOption('custom');
    await page.getByLabel('From', { exact: true }).fill(lastWeek);
    await page.getByLabel('To', { exact: true }).fill(today);
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForURL(/period=custom/);

    const from = new URL(page.url()).searchParams.get('from') ?? '';

    expect(await page.evaluate(isLocalMidnight, from)).toBe(true);
    expect(await page.evaluate(browserLocalDayOf, from)).toBe(lastWeek);
  });
});

test.describe('the eval page in dark mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(storeDarkTheme);
  });

  test('grader lines switch to the dark palette so they stay readable', async ({ page }) => {
    await page.goto(`/dashboard/evals/${fixtures.spreadOutSlug}`);

    await expect(page.locator('html')).toHaveClass(/dark/);

    const vocionLine = page.locator('[data-testid="eval-trend-line"][data-series="vocion"]');

    // Vocion blue: #2a78d6 on light, #3987e5 on dark.
    await expect(vocionLine).toHaveCSS('stroke', 'rgb(57, 135, 229)');
  });
});
