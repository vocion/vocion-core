import type { Locator, Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDecisionsWorkspace } from './support/seed';

/**
 * "SETUP MY SOFTWARE FACTORY", ON A PHONE — the founder's run, 2026-10-09:
 * "I am confused with two prompts in different areas with diff load in and
 * scroll behavior."
 *
 * A tracker review waits on the person outside any conversation (filed over
 * the API, as an integration files one). The person types the line on an
 * iPhone-sized screen; the scripted lead asks one Decision. Asserted:
 *
 * - the review never docks by itself — not the moment they send, not while
 *   the turn runs, not beside the lead's own question;
 * - the lead's Decision docks with its question and its Submit on the screen
 *   in portrait and on its side, with the box to type in still on the screen;
 * - every control in the dock is a thumb's 44px;
 * - a reload keeps the Decision docked where it was;
 * - once it is answered, the review is one quiet chip, and docks only when
 *   tapped, as "Waiting on you".
 *
 * Run with the scripted model (`npm run e2e:decisions`). `DECISIONS_SHOTS`
 * names a directory for the screenshots. Fixtures are fictional (Northwind).
 */

const SHOTS = process.env.DECISIONS_SHOTS;
const QUESTION = 'Which repositories should the factory include?';
const REVIEW = 'Review NW-142: approve the login-timeout fix for release?';
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

test.use({
  viewport: PORTRAIT,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

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
    await page.screenshot({ path: `${SHOTS}/mobile-${name}.png` });
  }
}

/**
 * Whether the element is drawn on the screen, top to bottom.
 * @param page - The page.
 * @param el - The element.
 */
async function onScreen(page: Page, el: Locator): Promise<boolean> {
  const box = await el.boundingBox();
  const size = page.viewportSize()!;
  return !!box && box.y >= -1 && box.y + box.height <= size.height + 1;
}

test('the setup Decision docks alone, readable and reachable on a phone; what waits elsewhere waits as one chip', async ({ page }) => {
  await signIn(page);

  // What waits elsewhere: a review a tracker filed, in no conversation.
  const filed = await page.request.post('/api/v1/asks', {
    data: { kind: 'approval', title: REVIEW, body: 'Filed from the tracker.', sourceRef: `e2e:tracker-review:${Date.now()}`, options: [{ id: 'approve', label: 'Approve', recommended: true }, { id: 'reject', label: 'Reject' }] },
  });

  expect(filed.status()).toBeLessThan(300);

  await page.goto('/dashboard/chat?new=1');
  const box = page.locator('textarea[data-agent-composer]').last();

  await expect(box).toBeVisible({ timeout: 120_000 });

  await box.tap();
  await box.fill('setup my software factory');
  await page.getByRole('button', { name: 'Send message' }).last().tap();

  // The moment it is sent, and all the while the lead answers: no review card.
  const review = page.getByTestId('decision-card').filter({ hasText: REVIEW });
  for (let i = 0; i < 6; i++) {
    await expect(review).toHaveCount(0);

    await page.waitForTimeout(250);
  }
  await shot(page, '01-sent');

  // The lead's own Decision, alone in the dock.
  const card = page.getByRole('dialog', { name: QUESTION });

  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('decision-card')).toHaveCount(1);
  await expect(review).toHaveCount(0);
  await expect(page.getByTestId('waiting-nudge')).toHaveCount(0);

  // Its question and Submit are on the screen; so is the box to type in.
  await card.getByTestId('decision-submit').scrollIntoViewIfNeeded();

  expect(await onScreen(page, card.getByTestId('decision-head'))).toBe(true);
  expect(await onScreen(page, card.getByTestId('decision-submit'))).toBe(true);
  expect(await onScreen(page, card.getByRole('option', { name: /Northwind API/ }))).toBe(true);
  expect(await onScreen(page, box)).toBe(true);

  await shot(page, '02-docked');

  // A thumb's 44px, every control in the dock.
  const small = await card.evaluate(slot => [...slot.querySelectorAll<HTMLElement>('button, input, [role=option]')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ el: el.dataset.testid ?? el.textContent?.trim(), h: Math.round(el.getBoundingClientRect().height) }))
    .filter(t => t.h < 44));

  expect(small).toEqual([]);

  // On its side: the card is full height in the thread, which scrolls
  // naturally to its question and to Submit; the box to type in stays on the
  // screen throughout (founder, 2026-10-09: no capped box, no inner scroll).
  await page.setViewportSize(LANDSCAPE);

  await expect(card).toBeVisible();

  await card.getByTestId('decision-head').scrollIntoViewIfNeeded();

  expect(await onScreen(page, card.getByTestId('decision-head'))).toBe(true);
  expect(await onScreen(page, box)).toBe(true);

  await card.getByTestId('decision-submit').scrollIntoViewIfNeeded();

  expect(await onScreen(page, card.getByTestId('decision-submit'))).toBe(true);
  expect(await onScreen(page, box)).toBe(true);

  await shot(page, '03-landscape');
  await page.setViewportSize(PORTRAIT);

  // A reload keeps the place: the same Decision, docked, nothing else.
  await page.reload();

  await expect(page.getByRole('dialog', { name: QUESTION })).toBeVisible({ timeout: 60_000 });
  await expect(review).toHaveCount(0);

  await shot(page, '04-reloaded');

  // Answered by touch: the turn lands, and the review is one quiet chip.
  await page.getByRole('dialog', { name: QUESTION }).getByRole('option', { name: /Northwind API/ }).tap();
  await page.getByRole('dialog', { name: QUESTION }).getByTestId('decision-submit').tap();

  await expect(page.getByText('Including the Northwind API.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Stop generating' })).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId('waiting-nudge')).toBeVisible({ timeout: 30_000 });
  await expect(review).toHaveCount(0);

  await shot(page, '05-chip');

  // A tap answers it where it lives — Review — never a card docked here
  // without a turn (founder, 2026-10-09: chips are prompts, not shortcuts).
  await expect(page.getByRole('link', { name: /thing waiting on you/ })).toHaveAttribute('href', /\/dashboard\/inbox$/);
  await expect(review).toHaveCount(0);
});
