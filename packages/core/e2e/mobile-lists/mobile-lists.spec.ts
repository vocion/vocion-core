import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

/**
 * A LIST ON A PHONE SHOWS ITS RECORDS, NOT ITS CONTROLS.
 *
 * Chris, 2026-10-09, on the Review queue at 390px: "Header too tall. I can't
 * read enough text on these rows to understand what they are. Global fix." The
 * header took 60% of the screen and each title was cut to ten characters. The
 * fix is in the shared pieces (`TitleBar`, `ListToolbar` / `CompactFilters`,
 * `ListRow`), and this is the rule that keeps every list honest, at 390×844:
 *
 * 1. the first record starts in the top 35% of the viewport;
 * 2. a row title wraps rather than truncating to one line, has room for about
 *    40 characters over its two lines, and a short title is never clipped.
 *
 * Self-seeding like `needs-you`: its own admin, its own fictional rows
 * (`support/seed-lists.ts`). Run with: npx playwright test --project=mobile-lists
 */

const ADMIN = {
  name: 'Phone Lists Admin',
  account: 'Phone Lists E2E Co',
  email: 'phone-lists-admin@example.test',
  password: 'phone-lists-admin-1',
};

const SEED = 'e2e/mobile-lists/support/seed-lists.ts';

/** Every list page with rows the seed guarantees. */
const PAGES = [
  '/dashboard/inbox',
  '/dashboard/inbox?scope=all',
  '/dashboard/briefings/archive',
  '/dashboard/notifications',
  '/dashboard/conversations',
  '/dashboard/members',
  '/dashboard/tools',
];

const ROW = '[data-pattern="list-row"], [data-testid="conversation-row"]';
const TITLE = '[data-slot="row-title"], [data-testid="conversation-row-name"]';

function createBootstrapAdmin(): void {
  try {
    execFileSync(
      'npm',
      ['run', '--silent', 'user:create:e2e', '--', '--email', ADMIN.email, '--name', ADMIN.name, '--account', ADMIN.account, '--password', ADMIN.password, '--role', 'admin'],
      { stdio: 'pipe' },
    );
  } catch (error) {
    const text = String((error as { stderr?: unknown }).stderr ?? '');
    if (!/already|exists/i.test(text)) {
      throw new Error(`user:create failed: ${text.trim().split('\n').at(-1) ?? error}`);
    }
  }
}

function seed(): void {
  try {
    execFileSync('npx', ['dotenv', '-c', '--', 'npx', 'tsx', SEED, '--email', ADMIN.email], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const err = error as { stderr?: unknown };
    throw new Error(`${SEED} failed: ${String(err.stderr ?? '').trim().split('\n').at(-1) ?? error}`);
  }
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test.skip(({ browserName }) => browserName === 'firefox', 'no phone emulation in Firefox');

test.describe.configure({ mode: 'serial' });

test.describe('lists on a phone', () => {
  let page: import('@playwright/test').Page;

  test.beforeAll(async ({ browser }) => {
    createBootstrapAdmin();
    seed();
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL(url => !url.pathname.includes('sign-in'));
  });

  test.afterAll(async () => {
    await page.close();
  });

  for (const path of PAGES) {
    test(`${path}: the first row is in the top 35% and titles wrap`, async () => {
      await page.goto(path);
      const first = page.locator(ROW).first();
      await first.waitFor();
      await page.evaluate(() => document.fonts.ready);

      const m = await page.evaluate(({ row, title }) => {
        const vh = window.innerHeight;
        const top = document.querySelector(row)!.getBoundingClientRect().top;
        const titles = Array.from(document.querySelectorAll<HTMLElement>(title))
          .filter(el => el.getBoundingClientRect().top < vh && el.offsetParent !== null)
          .map((el) => {
            const cs = getComputedStyle(el);
            return {
              text: (el.textContent ?? '').trim(),
              width: el.clientWidth,
              oneLine: cs.whiteSpace === 'nowrap' || cs.webkitLineClamp === '1',
              clipped: el.scrollHeight > el.clientHeight + 1,
            };
          });
        return { vh, top, titles };
      }, { row: ROW, title: TITLE });

      expect(m.top, `first row starts at ${Math.round(m.top)}px of ${m.vh}px`).toBeLessThanOrEqual(m.vh * 0.35);
      expect(m.titles.length).toBeGreaterThan(0);

      for (const t of m.titles) {
        expect(t.oneLine, `"${t.text}" is held to one line`).toBe(false);
        // ~7px a character at 14px: two lines of 150px hold about 40.
        expect(t.width, `"${t.text}" has ${t.width}px a line`).toBeGreaterThanOrEqual(150);

        if (t.text.length <= 40) {
          expect(t.clipped, `"${t.text}" is clipped`).toBe(false);
        }
      }
    });
  }

  test('the Review queue header is one row of chips, and its sheet holds search, filters and sort', async () => {
    await page.goto('/dashboard/inbox');
    await page.getByTestId('compact-filters-open').click();
    const sheet = page.getByTestId('compact-filters-sheet');

    await expect(sheet.getByRole('combobox').first()).toBeVisible();
    await expect(sheet.getByLabel('Sort')).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(sheet).toHaveCount(0);
  });

  test('a row\'s verbs are in its ⋯ menu, behind Undo', async () => {
    await page.goto('/dashboard/inbox');
    const subject = 'Approve the Bellwater Hall quarterly invoice reminder';
    const title = page.locator('[data-slot="row-title"]', { hasText: subject });
    await page.getByRole('button', { name: `Actions: ${subject}` }).click();
    await page.getByRole('menuitem', { name: 'Approve' }).click();

    // Hidden at once, and Undo puts it back before anything ran.
    await expect(title).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();

    await expect(title).toHaveCount(1);
  });
});
