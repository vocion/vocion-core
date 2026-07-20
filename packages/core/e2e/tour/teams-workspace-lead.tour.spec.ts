import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * F1 usage tour — "Teams + Workspace Lead" (design.md §5, the 8-shot
 * storyboard) as ONE cinematic spec with video on (playwright.config.ts
 * `tour` project). Self-seeding: runs against a FRESH PGlite-backed dev
 * server (zero users), creates the first-run admin via /sign-up, and
 * loads the bundled Meridian sample from the empty state — shot 1 IS the
 * empty state. No live model anywhere: shot 7 is the seeded composer
 * pre-fill, deliberately never sent.
 *
 * Every transition is gated by an assertion (deterministic); the fixed
 * `dwell` pauses only pace the video. See e2e/tour/README.md for the
 * exact command sequence.
 */

/** The "Chris-equivalent" first-run admin — becomes the workspace-default owner. */
const ADMIN = {
  name: 'Chris Fitkin',
  account: 'Meridian Outdoor',
  email: 'chris@meridianoutdoor.example',
  password: 'meridian-tour-1',
};

const INHERITED_OWNER = `${ADMIN.name} (workspace default)`;
const TEAM_NAMES = ['RevOps', 'Deal Desk', 'Founder GTM', 'Marketing'];

/**
 * Cinematic pause — pacing only; correctness is carried by the expects.
 * @param page - The tour page.
 * @param ms - How long the shot holds on screen.
 */
function dwell(page: Page, ms: number): Promise<void> {
  // eslint-disable-next-line playwright/no-wait-for-timeout -- video pacing, not synchronization; every transition is assertion-gated
  return page.waitForTimeout(ms);
}

test('F1 storyboard: empty state → seed → org chart → provenance → team detail → workspace lead → chat pre-fill → under the hood', async ({ page }) => {
  // ── Prologue (not a storyboard shot): first-run admin on the fresh DB ──
  await page.goto('/sign-up');

  await expect(
    page.getByRole('heading', { name: 'Set up your Vocion instance' }),
    'tour needs a FRESH database (zero users) — restart the PGlite dev server, see e2e/tour/README.md',
  ).toBeVisible();

  await page.getByLabel('Your name').fill(ADMIN.name);
  await page.getByLabel('Account / team name').fill(ADMIN.account);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Create instance + sign in' }).click();
  await page.waitForURL('**/dashboard**');

  // ── Shot 1 — fresh workspace: the Teams empty state is honest + self-solving ──
  await page.goto('/dashboard/teams');

  await expect(page.getByText('No teams yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load the sample revenue workspace' })).toBeVisible();

  await dwell(page, 2000);

  // ── Shot 2 — one click (plus confirm) seeds the sample; the org chart populates ──
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Load the sample revenue workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Revenue Director' })).toBeVisible({ timeout: 30_000 });

  // ── Shot 3 — hold on the org chart: lead band on top, four teams flat beneath ──
  await expect(page.getByText('Workspace Lead', { exact: true })).toBeVisible();

  await page.getByRole('heading', { name: 'Revenue Director' }).hover();
  await dwell(page, 1500);
  for (const teamName of TEAM_NAMES) {
    await expect(page.getByRole('heading', { name: teamName })).toBeVisible();

    await page.getByRole('heading', { name: teamName }).hover();
    await dwell(page, 500);
  }
  await dwell(page, 1000);

  // ── Shot 4 — accountability provenance: explicit owner vs inherited-with-tooltip ──
  await page.getByText('Lili Chen', { exact: true }).hover(); // Marketing's explicit override
  await dwell(page, 1200);
  await page.getByText(INHERITED_OWNER).first().hover();

  await expect(
    page.getByText('Inherited from workspace default — set an owner on this team to override.').first(),
  ).toBeVisible();

  await dwell(page, 1500);

  // ── Shot 5 — team detail: purpose, people, owner, and the approval boundary ──
  await page.getByRole('heading', { name: 'RevOps' }).click();
  await page.waitForURL('**/dashboard/teams/revenue-ops');

  await expect(page.getByRole('heading', { name: 'RevOps' })).toBeVisible();
  await expect(page.getByText('What runs free / what waits')).toBeVisible();
  await expect(page.getByText('Reads & analysis: run freely')).toBeVisible();
  await expect(page.getByText('for your approval — drafted, never sent alone')).toBeVisible();

  await page.getByText('What runs free / what waits').hover();
  await dwell(page, 2500);

  // ── Shot 6 — back to the org chart: the workspace lead has a front door ──
  await page.goBack();
  await page.waitForURL('**/dashboard/teams');
  const askButton = page.getByRole('link', { name: 'Ask how the quarter is going' });

  await expect(askButton).toBeVisible();

  await askButton.hover();
  await dwell(page, 1500);

  // ── Shot 7 — chat opens with the seeded quarter prompt. The pre-fill IS the
  //    shot: no live model in the tour, so the message is deliberately not sent. ──
  await askButton.click();
  await page.waitForURL('**/dashboard/chat**');
  const composer = page.locator('textarea');

  await expect(composer).toHaveValue('How\'s the quarter going?');

  await dwell(page, 3000);

  // ── Shot 8 — under the hood: YAML exists but never blocks the leader ──
  await page.goto('/dashboard/teams/revenue-ops');
  const underTheHood = page.getByText('Under the hood', { exact: true });
  await underTheHood.scrollIntoViewIfNeeded();
  await underTheHood.click();

  await expect(page.getByText('revenue-ops', { exact: true })).toBeVisible(); // the slug — demoted, not hidden

  await dwell(page, 1500);
  await underTheHood.click(); // collapse again

  // Close on the org chart.
  await page.goto('/dashboard/teams');

  await expect(page.getByRole('heading', { name: 'Revenue Director' })).toBeVisible();

  await dwell(page, 2000);
});
