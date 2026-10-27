import type { Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { tolerateExistingUser } from '../TestUtils';

/**
 * PINNED ROWS REORDER BY DRAG, AND THE ORDER STICKS.
 *
 * Chris, 2026-10-27: "left sidebar nav, for pinned item, allow drag drop
 * reorder". The Pinned group was draggable, but a drop named an INDEX in what
 * the group showed and that index was applied to every pin the person had.
 * A work row pinned before them (drawn in the main list, not in Pinned)
 * shifted every drop by one, and a drag down by one did nothing. The pinned
 * work rows in the main list could not be moved at all.
 *
 * Its own person, so the shared admin's sidebar is never rearranged under
 * another spec. Fresh per run: pins are stored per person.
 */

// Native drag and drop is driven with the mouse; Chromium is the browser the suite runs.
test.skip(({ browserName }) => browserName !== 'chromium', 'mouse-driven native drag');

const PERSON = {
  name: 'Pin Order Admin',
  account: 'Bellwater Hall',
  email: `pin-order-${Date.now()}@example.test`,
  password: 'pin-order-admin-1',
};

test.beforeAll(() => {
  try {
    execFileSync(
      'npm',
      ['run', '--silent', 'user:create:e2e', '--', '--email', PERSON.email, '--name', PERSON.name, '--account', PERSON.account, '--password', PERSON.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    tolerateExistingUser(error, '[nav pin reorder]');
  }
});

const pinnedGroup = (page: Page) => page.locator('[data-sidebar="group"]').filter({ has: page.locator('[data-sidebar="group-label"]', { hasText: 'Pinned' }) });
const names = (group: Locator) => group.locator('[data-sidebar="menu-button"]').allInnerTexts();

/**
 * Click a row's pin control until it reads Unpin: a click that lands before
 * the sidebar has hydrated does nothing, and the control is only revealed on
 * hover. One click per attempt, so a late one is never undone by the next.
 * @param pin - The Pin control.
 * @param unpin - The Unpin control it becomes.
 */
async function pinOnce(pin: Locator, unpin: Locator) {
  await expect(async () => {
    if (!(await unpin.count())) {
      await pin.click({ force: true });
    }

    await expect(unpin).toBeAttached({ timeout: 2_000 });
  }).toPass();
}

/**
 * Drag one row onto the lower half of another with the mouse, as a person does.
 * @param page - The page.
 * @param from - The row picked up.
 * @param to - The row it is dropped on.
 */
async function dragBelow(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + 60, b.y + b.height * 0.75, { steps: 12 });
  await page.mouse.up();
}

test('pinned rows move by drag and by Alt+Arrow, and keep their order after a reload', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(PERSON.email);
  await page.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(url => !url.pathname.includes('sign-in'));

  await page.goto('/dashboard/chat');
  const sidebar = page.locator('[data-sidebar="content"]');

  // A work row pinned FIRST: it is drawn in the main list, not in Pinned, so
  // it sits in the pin list ahead of every row the Pinned group shows.
  const more = page.getByTestId('nav-more-toggle');
  if ((await more.getAttribute('aria-expanded')) !== 'true') {
    await more.click();
  }
  const workPin = sidebar.locator('button[aria-label^="Pin: "]').first();
  const workName = (await workPin.getAttribute('aria-label'))!.replace('Pin: ', '');
  await pinOnce(workPin, sidebar.locator(`[aria-label="Unpin: ${workName}"]`).first());

  // Three Manage rows, pinned from the Manage view.
  await page.getByText('Manage workspace').click();
  const pinned: string[] = [];
  for (let i = 0; i < 3; i++) {
    const pin = page.locator('[data-sidebar="menu-action"][aria-label^="Pin: "]').first();
    pinned.push((await pin.getAttribute('aria-label'))!.replace('Pin: ', ''));
    await pinOnce(pin, page.locator(`[data-sidebar="menu-action"][aria-label="Unpin: ${pinned[i]}"]`).first());
  }
  await page.getByRole('button', { name: 'Back to work' }).click();

  const group = pinnedGroup(page);
  const [a, b, c] = pinned as [string, string, string];

  await expect.poll(() => names(group)).toEqual([a, b, c]);

  // Down by one: the drag that used to do nothing.
  const rows = group.locator('[data-pin-row]');
  await dragBelow(page, rows.nth(0), rows.nth(1));

  await expect.poll(() => names(group)).toEqual([b, a, c]);
  await expect(page).toHaveURL(/\/dashboard\/chat/);

  // The keyboard moves it too, and keeps it focused.
  await rows.nth(1).locator('[data-sidebar="menu-button"]').focus();
  await page.keyboard.press('Alt+ArrowDown');

  await expect.poll(() => names(group)).toEqual([b, c, a]);
  await expect(rows.nth(2).locator('[data-sidebar="menu-button"]')).toBeFocused();

  // Stored like the pins: the order comes back from the server, not just this browser.
  await page.evaluate(() => localStorage.removeItem('vocion:nav:pins'));
  await page.reload();

  await expect.poll(() => names(pinnedGroup(page))).toEqual([b, c, a]);
});
