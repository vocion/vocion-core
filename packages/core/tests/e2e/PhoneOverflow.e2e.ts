import { devices, expect, test } from '@playwright/test';
import { signIn } from '../TestUtils';

/**
 * THE PHONE SHELL NEVER SCROLLS SIDEWAYS (backlog 023).
 *
 * Chris, 2026-09-25: "Chat is having width and overflow issues on mobile.
 * Some text. Some compose bar… It should act more like an app." Each screen
 * used to fix its own overflow by hand; this is the rule that keeps every
 * screen honest: at a phone's width the document is never wider than the
 * viewport, and no element's box hangs past its right edge — with the
 * composer holding the worst input a person can paste (an unbroken 300-char
 * id) and the sidebar open.
 */
test.use({ ...devices['iPhone 14'] });

const PAGES = ['/dashboard/chat', '/dashboard/inbox', '/dashboard/briefings', '/dashboard/artifacts', '/dashboard/search', '/dashboard/settings'];

/**
 * Widest thing on the page, measured two ways: the document itself, and the
 * right edge of every element (a `position: fixed` bar can hang off the
 * screen without widening the document).
 * @param page - The phone.
 */
async function overflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const doc = document.documentElement.scrollWidth;
    const hanging: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      // Off-screen on purpose (a closed sheet, a portal parked at -9999)
      // is not overflow; a box that STARTS on screen and ends past the edge is.
      if (r.width > 0 && r.left < vw && r.right > vw + 1 && getComputedStyle(el).visibility !== 'hidden') {
        hanging.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)}`);
      }
    }
    return { vw, doc, hanging: hanging.slice(0, 8) };
  });
}

test.describe('phone shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const path of PAGES) {
    test(`${path} fits the phone`, async ({ page }) => {
      await page.goto(path);
      await page.getByRole('main').first().waitFor();

      const o = await overflow(page);

      expect(o.doc, `document is ${o.doc}px wide on a ${o.vw}px phone`).toBeLessThanOrEqual(o.vw);
      expect(o.hanging, 'elements hanging past the right edge').toEqual([]);
    });
  }

  test('the composer holding an unbroken 300-char id does not push the page sideways', async ({ page }) => {
    await page.goto('/dashboard/chat');
    const box = page.locator('textarea').last();
    await box.click();
    await box.fill('x'.repeat(300));

    const o = await overflow(page);

    expect(o.doc).toBeLessThanOrEqual(o.vw);
    expect(o.hanging).toEqual([]);
  });

  test('the sidebar sheet fits the phone', async ({ page }) => {
    await page.goto('/dashboard/chat');
    await page.getByRole('button', { name: /toggle sidebar/i }).first().click();
    await page.waitForTimeout(400);

    const o = await overflow(page);

    expect(o.doc).toBeLessThanOrEqual(o.vw);
    expect(o.hanging).toEqual([]);
  });
});
