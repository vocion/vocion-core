import type { Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * THE SIDEBAR DRAWER ON A PHONE (founder, 2026-10-09, on an iPhone).
 *
 * 1. The workspace picker's list scrolls by touch. It is a popover inside the
 *    drawer, and the drawer's scroll lock used to swallow every touchmove on
 *    it (`components/ui/modalLayer.ts`).
 * 2. Every way out of the drawer closes it: "We keep having that problem.
 *    Global solution." One rule does it (`components/ui/drawerClose.ts`), and
 *    this spec walks EVERY link the drawer and its popovers offer, rather than
 *    a list of known ones, so a link added next month is covered the day it
 *    lands.
 *
 * Self-seeding (`support/seed-phone-drawer-fixtures.ts`): one person in one
 * Org with twelve workspaces, more than the picker shows at once.
 */

const SEED_SCRIPT = 'e2e/phone-drawer/support/seed-phone-drawer-fixtures.ts';
// Must match the seed script.
const PERSON = { email: 'phone-drawer@e2e.example', password: 'phone-drawer-e2e-pass-1' };
const HOME = '/w/e2e-phone-home/dashboard/chat';
// Twelve seeded, and the Personal workspace every person gets at sign-in.
const WORKSPACE_COUNT = 13;

test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
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

// By its slot, not its role: an open modal popover hides the drawer from the
// accessibility tree while it is up, as it should.
const drawer = () => page.locator('[data-sidebar="sidebar"][data-mobile="true"]');

async function openDrawer(at = HOME): Promise<Locator> {
  await page.goto(at);
  await page.getByRole('button', { name: /toggle sidebar/i }).first().click();

  await expect(drawer()).toBeVisible();

  return drawer();
}

async function openPicker(): Promise<Locator> {
  await drawer().getByRole('button', { name: 'Switch workspace' }).click();
  const list = page.getByRole('listbox', { name: 'Switch workspace' });

  await expect(list.getByRole('option')).toHaveCount(WORKSPACE_COUNT);

  return list;
}

/**
 * A path without its `/w/<workspace>` prefix: where the page is, whichever workspace it names.
 * @param href
 */
function pagePath(href: string): string {
  const url = new URL(href, 'http://phone.example');
  return url.pathname.replace(/^\/w\/[^/]+/, '') || '/';
}

/**
 * The links a container offers that stay in this tab, by href.
 * @param container
 */
async function linksIn(container: Locator): Promise<string[]> {
  const hrefs = await container.locator('a[href]').evaluateAll(els => els
    .filter(a => !(a as HTMLAnchorElement).target || (a as HTMLAnchorElement).target === '_self')
    .map(a => a.getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter(Boolean))];
}

/**
 * Click, then: the drawer is gone and the page is the one the link named.
 * @param target - What to tap.
 * @param href - Where it goes.
 */
async function leavesDrawerFor(target: Locator, href: string): Promise<void> {
  await target.click();

  await expect(drawer(), `${href} left the drawer open`).toBeHidden();
  await expect.poll(() => pagePath(page.url()), { message: `${href} did not navigate` }).toBe(pagePath(href));
}

test('the workspace picker scrolls by touch inside the drawer', async () => {
  await openDrawer();
  const list = await openPicker();

  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await list.evaluate(el => el.scrollTop)).toBe(0);

  // A real touch drag, not a scrollTop write: the scroll lock only ever
  // refused touch and wheel events. The popover zooms in, so wait for it to
  // settle, and drag again until the list moves: on the CI box the first
  // gesture can land before the lock's listeners are attached (2026-10-09).
  // With the lock swallowing touches, no number of drags moves it.
  await list.evaluate(el => Promise.all(el.closest('[data-slot="popover-content"]')?.getAnimations({ subtree: true }).map(a => a.finished) ?? []));
  const cdp = await page.context().newCDPSession(page);

  await expect(async () => {
    const box = (await list.boundingBox())!;
    await cdp.send('Input.synthesizeScrollGesture', {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height * 0.75),
      yDistance: -Math.round(box.height / 2),
      gestureSourceType: 'touch',
      speed: 600,
    });

    expect(await list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  // The drawer under it stayed put: still open, and the page did not move.
  await expect(drawer()).toBeVisible();
});

test('every link in the drawer closes it and lands on its page', async () => {
  const hrefs = await linksIn(await openDrawer());

  expect(hrefs.length).toBeGreaterThan(2);

  for (const href of hrefs) {
    await leavesDrawerFor((await openDrawer()).locator(`a[href="${href}"]`).first(), href);
  }
});

test('every link under a "More" menu closes the drawer', async () => {
  const more = (await openDrawer()).getByRole('button', { name: 'More' });
  const menus = await more.count();

  expect(menus).toBeGreaterThan(0);

  for (let m = 0; m < menus; m++) {
    await (await openDrawer()).getByRole('button', { name: 'More' }).nth(m).click();
    const hrefs = await linksIn(page.getByRole('menu'));
    for (const href of hrefs) {
      await (await openDrawer()).getByRole('button', { name: 'More' }).nth(m).click();
      await leavesDrawerFor(page.getByRole('menu').locator(`a[href="${href}"]`).first(), href);
    }
  }
});

test('every Getting started step closes the drawer and starts its turn', async () => {
  const toggle = (await openDrawer()).getByTestId('getting-started-toggle');
  await toggle.click();
  const hrefs = await linksIn(drawer().getByTestId('getting-started'));

  expect(hrefs).toHaveLength(5);

  for (const href of hrefs) {
    await (await openDrawer()).getByTestId('getting-started-toggle').click();
    await leavesDrawerFor(drawer().locator(`a[href="${href}"]`).first(), href);
  }
});

test('the picker: All workspaces and a workspace switch close the drawer', async () => {
  await openDrawer();
  let list = await openPicker();
  await leavesDrawerFor(page.getByTestId('workspace-switcher-all'), '/dashboard/workspaces');

  await openDrawer();
  list = await openPicker();
  await list.getByRole('option', { name: 'Kestrel Capital' }).click();

  await expect(drawer()).toBeHidden();
  await expect(page).toHaveURL(/e2e-phone-kestrel-capital|\/dashboard/);

  // Back home for the rest of the file.
  await page.goto(HOME);
});

test('Settings and Manage workspace open the manage view in place, and each of its links closes the drawer', async () => {
  // Both are the drawer's own mode switch (the manage view has no URL), so
  // they keep the drawer open on purpose; the way out is any link in it.
  await openDrawer();
  await openPicker();
  await page.getByTestId('workspace-switcher-settings').click();

  await expect(drawer()).toBeVisible();
  await expect(drawer().getByRole('button', { name: 'Back to work' })).toBeVisible();

  await drawer().getByRole('button', { name: 'Back to work' }).click();

  await drawer().getByTestId('manage-workspace-row').click();

  await expect(drawer().getByRole('button', { name: 'Back to work' })).toBeVisible();

  const hrefs = await linksIn(drawer());

  expect(hrefs.length).toBeGreaterThan(2);

  for (const href of hrefs) {
    const d = await openDrawer();
    if (await d.getByTestId('manage-workspace-row').isVisible()) {
      await d.getByTestId('manage-workspace-row').click();
    }
    await leavesDrawerFor(d.locator(`a[href="${href}"]`).first(), href);
  }
});

test('the signed-in row is a label, not a door', async () => {
  const d = await openDrawer();
  const row = d.getByTestId('sidebar-user');

  await expect(row).toBeVisible();
  // Nothing to tap: the account menu lives in the top bar.
  await expect(row.locator('a, button')).toHaveCount(0);
});
