import type { Browser, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { devices, expect, test } from '@playwright/test';

/**
 * PIN TO SIDEBAR (founder, 2026-10-09: "can I get ability to Pin
 * artifacts/wikis/chats/data rooms to favorites? that show up in my
 * sidebar?").
 *
 * One person, two workspaces. In Northwind they pin a doc and a data room
 * from their headers and a chat with ⌘⇧P, reorder the Pinned section, unpin
 * one from its hover ×, and see a deleted chat leave quietly. Kestrel shows
 * none of it: pins belong to the workspace they were made in. On a phone the
 * Pinned section sits in the drawer, under the main nav.
 *
 * Self-seeding (`support/seed-pins-fixtures.ts`).
 */

const SEED_SCRIPT = 'e2e/pins/support/seed-pins-fixtures.ts';
const PERSON = { email: 'pins@e2e.example', password: 'pins-e2e-pass-1' };
const NORTHWIND = '/w/e2e-pins-northwind/dashboard';
const KESTREL = '/w/e2e-pins-kestrel/dashboard';
const TITLES = { doc: 'Contoso supply pricing memo', room: 'Larkfield Systems diligence', chat: 'Northwind renewal plan' };

test.describe.configure({ mode: 'serial' });

let page: Page;
let ids: { conversation: number; artifact: number; room: number };

function seed(...args: string[]): string {
  return execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED_SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

async function signIn(browser: Browser, options: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const context = await browser.newContext(options);
  const p = await context.newPage();
  await p.goto('/sign-in');
  await p.getByLabel('Email').fill(PERSON.email);
  await p.getByLabel('Password', { exact: true }).fill(PERSON.password);
  await p.getByRole('button', { name: /sign in/i }).click();
  await p.waitForURL(/\/dashboard/);
  return p;
}

test.beforeAll(async ({ browser }) => {
  ids = JSON.parse(seed().trim().split('\n').pop()!);
  page = await signIn(browser);
});

test.afterAll(async () => {
  await page.context().close();
});

const sidebar = (p: Page = page) => p.locator('[data-sidebar="sidebar"]').first();
const pinnedRows = (p: Page = page) => sidebar(p).locator('[data-pin-key]');
// The header's toggle, clicked once the page is live (a click before
// hydration does nothing), and held until the server has the pin.
async function pinFromHeader(p: Page = page) {
  const toggle = p.getByTestId('pin-toggle');

  await expect(async () => {
    const saved = p.waitForResponse(r => r.url().includes('/rpc/nav/pin') && r.ok(), { timeout: 3000 });
    await toggle.click();
    await saved;
  }).toPass();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}
const pinnedTitles = async () => pinnedRows().evaluateAll(rows => rows.map(r => r.querySelector('a')?.getAttribute('title') ?? ''));

test('a doc and a data room pin from their headers; two pins make the Pinned section', async () => {
  await page.goto(`${NORTHWIND}/artifacts/${ids.artifact}`);
  await pinFromHeader();

  // One pin is a row in the main list (no one-row sections), already linked.
  await expect(sidebar().getByRole('link', { name: TITLES.doc })).toBeVisible();

  await page.goto(`${NORTHWIND}/rooms/${ids.room}`);
  await pinFromHeader();

  await expect(sidebar().getByText('Pinned', { exact: true })).toBeVisible();
  await expect.poll(pinnedTitles).toEqual([TITLES.doc, TITLES.room]);
});

test('⌘⇧P pins the chat on screen, with Undo in the toast', async () => {
  await page.goto(`${NORTHWIND}/chat/${ids.conversation}`);

  await expect(page.getByRole('heading', { name: TITLES.chat })).toBeVisible();

  await page.locator('body').click({ position: { x: 600, y: 300 } });
  await page.keyboard.press('ControlOrMeta+Shift+KeyP');

  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect.poll(pinnedTitles).toEqual([TITLES.doc, TITLES.room, TITLES.chat]);
});

test('reorder from a row\'s ⋯, and the order survives a reload', async () => {
  const room = pinnedRows().filter({ has: page.getByRole('link', { name: TITLES.room }) });
  await room.hover();
  await room.getByTestId('pinned-row-menu').click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();

  await expect.poll(pinnedTitles).toEqual([TITLES.room, TITLES.doc, TITLES.chat]);

  await page.reload();

  await expect.poll(pinnedTitles).toEqual([TITLES.room, TITLES.doc, TITLES.chat]);
});

test('unpin from the hover ×', async () => {
  const doc = pinnedRows().filter({ has: page.getByRole('link', { name: TITLES.doc }) });
  await doc.hover();
  await doc.getByTestId('pinned-row-remove').click();

  await expect.poll(pinnedTitles).toEqual([TITLES.room, TITLES.chat]);
});

test('a pinned chat that was deleted disappears quietly', async () => {
  seed('--delete-conversation', String(ids.conversation));
  await page.goto(`${NORTHWIND}/rooms/${ids.room}`);

  await expect(sidebar().getByRole('link', { name: TITLES.room })).toBeVisible();
  await expect(sidebar().getByRole('link', { name: TITLES.chat })).toHaveCount(0);
});

test('pins belong to their workspace: Kestrel shows none of Northwind\'s', async () => {
  // Back to two pins in Northwind, for the phone below.
  await page.goto(`${NORTHWIND}/artifacts/${ids.artifact}`);
  await pinFromHeader();

  await expect.poll(pinnedTitles).toEqual([TITLES.room, TITLES.doc]);

  await page.goto(`${KESTREL}/chat`);

  await expect(sidebar().getByRole('link', { name: 'Chat', exact: true })).toBeVisible();
  await expect(pinnedRows()).toHaveCount(0);
  await expect(sidebar().getByRole('link', { name: TITLES.room })).toHaveCount(0);
});

test('on a phone the Pinned section sits in the drawer under the main nav, and a pin closes the drawer', async ({ browser }) => {
  const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 14'];
  const phone = await signIn(browser, iphone);
  await phone.goto(`${NORTHWIND}/chat`);
  await phone.getByRole('button', { name: /toggle sidebar/i }).first().click();
  const drawer = phone.locator('[data-sidebar="sidebar"][data-mobile="true"]');

  await expect(drawer.getByText('Pinned', { exact: true })).toBeVisible();

  const chat = await drawer.getByRole('link', { name: 'Chat', exact: true }).boundingBox();
  const pinned = await drawer.getByText('Pinned', { exact: true }).boundingBox();

  expect(pinned!.y).toBeGreaterThan(chat!.y);

  await drawer.getByRole('link', { name: TITLES.room }).click();
  await phone.waitForURL(new RegExp(`/rooms/${ids.room}`));

  await expect(drawer).toBeHidden();

  await phone.context().close();
});
