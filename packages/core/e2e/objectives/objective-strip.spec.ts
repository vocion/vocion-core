import type { Page } from '@playwright/test';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { ADMIN, seedDecisionsWorkspace } from '../decisions/support/seed';

/**
 * CONTEXT MID-OBJECTIVE, END TO END (founder, 2026-10-09: "Does it give or
 * should I have context mid objective?").
 *
 * Software Factory is added from its app page, as a person adds it. "setup my
 * software factory": the scripted lead reads the setup (`describe_setup`),
 * which starts the objective, and asks one Decision. Asserted, on a phone and
 * on a desktop: one quiet line above the docked Decision, "Setting up
 * Software Factory · 1 of 3 · Stop"; tapping it lists the steps; it survives a
 * reload and a trip through the drawer; Stop pauses it ("Paused …", Resume);
 * and a new chat opens on the one hint "Resume Software Factory setup",
 * which opens the conversation where it stands.
 *
 * Run with the scripted model (`npm run e2e:objectives`). `OBJECTIVES_SHOTS`
 * names a directory for the screenshots. Fixtures are fictional (Northwind).
 */

const SHOTS = process.env.OBJECTIVES_SHOTS;
const QUESTION = 'Which repositories should the factory include?';

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

async function addTheFactory(page: Page) {
  await page.goto('/dashboard/apps/software-factory');
  const add = page.getByTestId('add-app-software-factory');
  if (await add.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await add.click();

    await expect(page.getByRole('link', { name: /Open Software Factory/ })).toBeVisible({ timeout: 60_000 });
  }
}

for (const device of [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false },
]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch });

    test(`one line says what the conversation is in the middle of, and the next visit offers to resume it (${device.name})`, async ({ page }) => {
      await signIn(page);
      await addTheFactory(page);

      await page.goto('/dashboard/chat?new=1');
      const box = page.locator('textarea[data-agent-composer]').last();

      await expect(box).toBeVisible({ timeout: 120_000 });

      await box.fill('setup my software factory');
      await page.getByRole('button', { name: 'Send message' }).last().click();

      const card = page.getByRole('dialog', { name: QUESTION });
      const strip = page.getByTestId('objective-strip');

      await expect(card).toBeVisible({ timeout: 120_000 });
      await expect(strip).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('objective-line')).toContainText(/Setting up Software factory/i);
      await expect(page.getByTestId('objective-progress')).toHaveText('1 of 3');
      await expect(page.getByTestId('objective-stop')).toBeVisible();

      // A setup step waits for its person: no "Default in 23h" under it.
      await expect(card.getByTestId('decision-deadline')).toHaveCount(0);

      // What the lead did, said as what it did for the person, never a tool's name.
      await expect(page.getByText(/Checked what setup is left/).first()).toBeVisible();
      await expect(page.getByText(/describe setup|describe_setup|file ask|file_ask/i)).toHaveCount(0);

      // One quiet line above the composer; the Decision is in the thread.
      const lineBox = (await strip.boundingBox())!;
      const cardBox = (await card.boundingBox())!;

      // The card is the latest item in the thread; the line stays pinned just
      // above the composer, below it.
      expect(lineBox.y).toBeGreaterThanOrEqual(cardBox.y);
      await expect(page.getByTestId('composer-above').getByTestId('decision-card')).toHaveCount(0);

      await shot(page, `${device.name}-01-line-above-the-decision`);

      // Tapped, it lists the steps.
      await page.getByTestId('objective-line').click();

      await expect(page.getByTestId('objective-step')).toHaveCount(3);
      await expect(page.getByTestId('objective-step').first()).toContainText('Connect GitHub');
      await expect(page.locator('[data-testid=objective-step][data-current]')).toContainText('Connect GitHub');

      await shot(page, `${device.name}-02-steps`);

      // A reload keeps it.
      await page.reload();

      await expect(page.getByTestId('objective-progress')).toHaveText('1 of 3', { timeout: 60_000 });
      await expect(page.getByRole('dialog', { name: QUESTION })).toBeVisible();

      // So does a trip through the drawer.
      await page.goto('/dashboard/inbox');
      await page.goBack();

      await expect(page.getByTestId('objective-progress')).toHaveText('1 of 3', { timeout: 60_000 });

      // Stop pauses it — and says so — and Resume takes it back up.
      await page.getByTestId('objective-stop').click();

      await expect(page.getByTestId('objective-line')).toContainText(/Paused setting up Software factory/i);

      await shot(page, `${device.name}-03-paused`);
      await page.getByTestId('objective-resume').click();

      await expect(page.getByTestId('objective-line')).toContainText(/^Setting up Software factory/i);

      await page.getByTestId('objective-stop').click();

      await expect(page.getByTestId('objective-resume')).toBeVisible();

      // The next visit opens on the one hint, and it opens the conversation where it stands.
      await page.goto('/dashboard/chat?new=1');
      // The opening hint ranker's own chip (#1272), its setup candidate resumed.
      const hint = page.getByTestId('opening-hint').filter({ hasText: /Resume Software factory setup/i });

      await expect(hint).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('opening-hint')).toHaveCount(1);

      await shot(page, `${device.name}-04-resume-hint`);
      await hint.getByRole('button').first().click();

      await expect(page.getByRole('dialog', { name: QUESTION })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('objective-line')).toContainText(/Paused setting up Software factory/i);

      await page.getByTestId('objective-resume').click();
      await shot(page, `${device.name}-05-resumed`);
    });
  });
}
