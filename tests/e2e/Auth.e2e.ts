import test, { expect } from '@playwright/test';

import { AUTH_FILE } from '../TestUtils';

test.use({ storageState: AUTH_FILE });

test.describe('Auth', () => {
  test.describe('Signup pages', () => {
    test('should navigate to Todos page', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByText('Todos').click();

      await expect(page).toHaveURL('/dashboard/todos');
    });
  });
});
