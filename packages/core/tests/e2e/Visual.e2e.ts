import { expect, takeSnapshot, test } from '@chromatic-com/playwright';

test.describe('Visual testing', () => {
  test.describe('Static pages', () => {
    // The only page an anonymous visitor reaches is the sign-in form (`/`
    // redirects there through `/dashboard`), and its heading is not
    // localised, so there is one snapshot, not one per locale.
    test('should take screenshot of the sign-in page', async ({ page }, testInfo) => {
      await page.goto('/');

      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

      await takeSnapshot(page, testInfo);
    });
  });
});
