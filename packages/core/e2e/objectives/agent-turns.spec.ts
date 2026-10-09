import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDecisionsWorkspace } from '../decisions/support/seed';

/**
 * CHIPS ARE PROMPTS, NOT SHORTCUTS — on a phone (founder, 2026-10-09, v5.22):
 * "After clicking I got a card immediately. Instead I would expect a chat turn
 * that results in a card … the card was unreadable because the inner scroll
 * content window was so tiny … In the sidebar I clicked on getting started
 * then connect systems … the sidebar didn't close … This is feeling like a
 * super deterministic button city."
 *
 * Asserted at 390×844:
 * - the opening hint reads whole (two lines at most, nothing cut mid-word);
 * - tapping it sends the person's own words: the welcome gives way to their
 *   message, then the lead's reply, and only THEN a card — never a card
 *   before an assistant message;
 * - the card is the latest item in the thread, full height, every option and
 *   its consequence and Submit visible as the thread scrolls;
 * - a Getting started step closes the drawer and sends a real turn too;
 * - the workspace picker lists empty workspaces, no slug lines, no toggle,
 *   and one footer row: All workspaces →, Settings.
 *
 * Run with the scripted model (`npm run e2e:objectives`). `AGENT_TURN_SHOTS`
 * names a directory for the screenshots. Fixtures are fictional (Northwind).
 */

const SHOTS = process.env.AGENT_TURN_SHOTS;
const PHONE = { width: 390, height: 844 };

test.use({ viewport: PHONE, isMobile: true, hasTouch: true });

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

/**
 * Record, in order, when the first assistant message and the first card appear.
 * @param page
 */
async function watchOrder(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __order: string[] };
    w.__order = [];
    const seen = new Set<string>();
    const look = () => {
      for (const [id, sel] of [['assistant', '[data-testid=assistant-message]'], ['card', '[data-testid=decision-card]']] as const) {
        if (!seen.has(id) && document.querySelector(sel)) {
          seen.add(id);
          w.__order.push(id);
        }
      }
    };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true });
    look();
  });
}

const orderOf = (page: Page) => page.evaluate(() => (window as unknown as { __order: string[] }).__order);

async function addTheFactory(page: Page) {
  await page.goto('/dashboard/apps/software-factory');
  const add = page.getByTestId('add-app-software-factory');
  if (await add.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await add.click();

    await expect(page.getByRole('link', { name: /Open Software Factory/ })).toBeVisible({ timeout: 60_000 });
  }
}

test('a hint is the person\'s own ask: a turn first, then the card it raised, full height in the thread', async ({ page }) => {
  await signIn(page);
  await addTheFactory(page);
  await page.goto('/dashboard/chat?new=1');

  // The hint reads whole at 390px.
  const hint = page.getByTestId('opening-hint').filter({ hasText: /Finish Software factory setup/i });

  await expect(hint).toBeVisible({ timeout: 60_000 });

  const label = hint.getByTestId('opening-hint-label');
  const clipped = await label.evaluate(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);

  expect(clipped).toBe(false);
  await expect(label).toHaveText(/^Finish Software factory setup · \d steps?$/i);

  await shot(page, '01-hint');
  await watchOrder(page);
  await hint.getByRole('button').first().tap();

  // The welcome gives way to the person's message: a turn has started.
  await expect(page.getByTestId('user-message').filter({ hasText: 'Help me finish setting up Software factory' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('chat-empty-state')).toHaveCount(0);
  await expect(page.getByTestId('lead-intro')).toHaveCount(0);

  await shot(page, '02-user-turn');

  // The lead answers in words; the card is the output of that turn.
  const card = page.getByTestId('decision-card');

  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/One question first, so I file the right ones/)).toBeVisible();

  expect(await orderOf(page)).toEqual(['assistant', 'card']);

  // Full height, in the thread — not a capped box above the composer.
  await expect(page.getByTestId('composer-above').getByTestId('decision-card')).toHaveCount(0);

  for (const text of ['Northwind API', 'Requests land as changes to northwind/api.', 'Northwind Portal', 'Both', 'One product, two repositories.']) {
    await expect(card.getByText(text, { exact: true })).toBeVisible();
  }
  const innerScroll = await card.evaluate(el => el.scrollHeight > el.clientHeight + 1);

  expect(innerScroll).toBe(false);

  await card.getByTestId('decision-submit').scrollIntoViewIfNeeded();

  await expect(card.getByTestId('decision-submit')).toBeInViewport();
  await expect(page.getByTestId('decision-eyebrow')).not.toHaveCSS('text-transform', 'uppercase');

  await shot(page, '03-agent-reply-card');

  // Answering is a turn too.
  await card.getByRole('option', { name: /Northwind API/ }).tap();
  await card.getByTestId('decision-submit').tap();

  // The card collapsed into the person's turn, the lead's reply follows it.
  const answered = page.getByTestId('decision-answer').last();

  await expect(answered.getByTestId('decision-answer-question')).toHaveText('Which repositories should the factory include?');
  await expect(answered.getByTestId('decision-answer-said')).toHaveText('Northwind API');
  await expect(page.getByText('Including the Northwind API.')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('decision-card')).toHaveCount(0);

  await shot(page, '04-answered');
});

test('a Getting started step closes the drawer and sends a real turn; the picker is plain', async ({ page }) => {
  await signIn(page);
  await addTheFactory(page);
  await page.goto('/dashboard/chat?new=1');

  await expect(page.locator('textarea[data-agent-composer]').last()).toBeVisible({ timeout: 60_000 });

  // The workspace picker: empty workspaces listed, no slug lines, one footer row.
  await page.getByRole('button', { name: /Toggle Sidebar/i }).first().tap();
  await page.getByRole('button', { name: /Switch/ }).first().tap();
  const footer = page.getByTestId('workspace-switcher-footer');

  await expect(footer).toBeVisible();
  await expect(page.getByText(/Show \d+ empty/)).toHaveCount(0);
  await expect(page.locator('[role=option] .font-mono')).toHaveCount(0);
  await expect(page.getByTestId('workspace-switcher-all')).toHaveText(/All workspaces/);
  await expect(page.getByTestId('workspace-switcher-settings')).toHaveText(/Settings/);

  const [all, settings] = await Promise.all([page.getByTestId('workspace-switcher-all').boundingBox(), page.getByTestId('workspace-switcher-settings').boundingBox()]);

  // One row, not two stacked.
  expect(Math.abs(all!.y - settings!.y)).toBeLessThan(4);

  await page.waitForTimeout(500);
  await shot(page, '05-picker');
  await page.keyboard.press('Escape');

  // Getting started → Connect a system.
  await page.getByTestId('getting-started-toggle').tap().catch(async () => page.getByText(/Getting started/).first().tap());
  await watchOrder(page);
  await page.getByTestId('getting-started-connect').tap();

  // The drawer closed, and the person's ask went out as a message.
  await expect(page.getByTestId('user-message').filter({ hasText: 'Help me connect the team connectors this workspace needs' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('getting-started-connect')).toBeHidden();

  await shot(page, '06-checklist-turn');

  await expect(page.getByTestId('decision-card')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/GitHub is the one system this workspace still needs/)).toBeVisible();
  // The lead's own why, composed at the turn, leads the step — not a stock line.
  await expect(page.getByTestId('decision-card')).toContainText('Software factory is installed and can do nothing until it reads your repositories.');
  await expect(page.getByTestId('decision-eyebrow')).toHaveText(/^Software Factory setup · 1 of \d/);

  expect(await orderOf(page)).toEqual(['assistant', 'card']);

  await shot(page, '07-checklist-card');
});
