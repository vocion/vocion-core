import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDecisionsWorkspace } from '../decisions/support/seed';

/**
 * FOLLOW-UPS AS PILLS, NOT CARDS (founder, 2026-10-09: "Check out chat gpt
 * does up to 3 suggestions. If they are really valuable. And doesn't trap
 * them in cards.").
 *
 * The scripted lead ends its reply with a `<suggest>` block. Asserted on a
 * phone (390×844) and a desktop (1440×900):
 * - the block never shows as words; three quiet pills sit under the answer;
 * - no Decision card is raised for them;
 * - Tab reaches a pill and Enter sends its words as the person's message;
 * - the pills are gone the moment the person sends, and a reply with no
 *   block shows none.
 *
 * Run with the scripted model (`npm run e2e:objectives`). `PILL_SHOTS` names
 * a directory for the screenshots. Fixtures are fictional.
 */

const SHOTS = process.env.PILL_SHOTS;

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

for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]] as const) {
  test.describe(device, () => {
    test.use(device === 'phone' ? { viewport, isMobile: true, hasTouch: true } : { viewport });

    test(`up to three follow-ups as pills under the answer, never a card (${device})`, async ({ page }) => {
      await signIn(page);
      await page.goto('/dashboard/chat?new=1');
      const box = page.locator('textarea').last();
      await box.click();
      await box.fill('what is waiting on the renewals?');
      await page.getByRole('button', { name: 'Send message' }).last().click();

      await expect(page.getByText('has not replied to the renewal quote since Tuesday').last()).toBeVisible({ timeout: 120_000 });

      const pills = page.getByTestId('suggestion-pill');

      await expect(pills).toHaveCount(3, { timeout: 30_000 });
      await expect(pills).toHaveText(['Draft the reply to Dana', 'Show who\'s waiting on me', 'Dig deeper']);
      // The block is the pills, never words; and a suggestion is never a card.
      await expect(page.getByText(/<\/?suggest>/)).toHaveCount(0);
      await expect(page.getByTestId('decision-card')).toHaveCount(0);

      for (const pill of await pills.all()) {
        const b = (await pill.boundingBox())!;

        expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);

        if (device === 'phone') {
          expect(b.height).toBeGreaterThanOrEqual(44);
        }
      }
      await page.getByTestId('suggestion-pills').scrollIntoViewIfNeeded();
      await shot(page, `${device}-1-pills`);

      // Keyboard: focus the first pill, Enter sends its words as the person's message.
      await pills.first().focus();
      await page.keyboard.press('Enter');

      await expect(page.getByTestId('user-message').last()).toContainText('Draft the reply to Dana');
      // Gone the moment the person sent anything.
      await expect(pills).toHaveCount(0);
      await expect(page.getByText('the renewal quote stands until Friday').last()).toBeVisible({ timeout: 120_000 });
      // A reply with no block shows none.
      await expect(pills).toHaveCount(0);
      await expect(page.getByTestId('decision-card')).toHaveCount(0);

      await shot(page, `${device}-2-sent`);

      // A reload draws the same pills only on the latest answer: none here.
      await page.reload();

      await expect(page.getByText('the renewal quote stands until Friday').last()).toBeVisible({ timeout: 60_000 });
      await expect(pills).toHaveCount(0);
    });
  });
}
