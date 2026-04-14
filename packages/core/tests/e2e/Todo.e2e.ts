import { faker } from '@faker-js/faker';
import test, { expect } from '@playwright/test';
import { createOrganization, signIn } from '../TestUtils';

test.describe('Todo', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);

    // Create a new organization for each test, to make sure there is no data between tests
    await createOrganization(page);
  });

  test.describe('Basic CRUD operations', () => {
    test('should create and edit a todo', async ({ page }) => {
      await page.getByText('Todos').click();

      // Check if there are no todos
      await expect(page.getByText('No results')).toBeVisible();

      // Create a new todo
      await page.getByRole('button', { name: 'New todo' }).click();

      await page.getByLabel('Title').fill(faker.word.words(3));
      await page.getByLabel('Message').fill(faker.word.words(10));
      await page.getByRole('button', { name: 'Submit' }).click();

      // Edit the todo
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();

      await page.getByLabel('Title').fill(`[EDITED] ${faker.word.words(3)}`);
      await page.getByRole('button', { name: 'Submit' }).click();

      // Check if the todo was edited
      await expect(page.getByText('[EDITED]')).toBeVisible();
    });

    test('should create and delete a todo', async ({ page }) => {
      await page.getByText('Todos').click();

      // Check if there are no todos
      await expect(page.getByText('No results')).toBeVisible();

      // Create a new todo
      await page.getByRole('button', { name: 'New todo' }).click();

      await page.getByLabel('Title').fill(faker.word.words(3));
      await page.getByLabel('Message').fill(faker.word.words(10));
      await page.getByRole('button', { name: 'Submit' }).click();

      // Delete the todo
      await page.getByRole('button', { name: 'Open menu' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();

      // Check if the todo was deleted
      await expect(page.getByText('No results')).toBeVisible();
    });
  });
});
