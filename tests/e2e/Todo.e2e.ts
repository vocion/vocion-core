import { faker } from '@faker-js/faker';
import test, { expect } from '@playwright/test';

import { AUTH_FILE } from '../TestUtils';

test.use({ storageState: AUTH_FILE });

test.describe('Todo', () => {
  test.describe('todo', () => {
    test('should navigate to Todos page', async ({ page }) => {
      await page.goto('/dashboard');
      await page.getByText('Todos').click();

      await expect(page.getByText('No results')).toBeVisible();

      // Create a new todo
      await page.getByRole('button', { name: 'New todo' }).click();

      await page.getByLabel('Title').fill(faker.word.words(3));
      await page.getByLabel('Message').fill(faker.word.words(10));
      await page.getByRole('button', { name: 'Submit' }).click();

      await expect(page.getByText('Todo List', { exact: true })).toBeVisible();

      // Edit the todo
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();

      await page.getByLabel('Title').fill(`[EDITED] ${faker.word.words(3)}`);
      await page.getByRole('button', { name: 'Submit' }).click();

      await expect(page.getByText('[EDITED]')).toBeVisible();
    });
  });
});
