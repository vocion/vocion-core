import path from 'node:path';

import test, { expect } from '@playwright/test';

const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

test.use({ storageState: authFile });

test.describe('Auth', () => {
  test.describe('Signup pages', () => {
    test('should navigate to Todos page', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByText('Todos').click();

      await expect(page).toHaveURL('/dashboard/todos');
    });
  });
});
