import { faker } from '@faker-js/faker';
import test, { expect } from '@playwright/test';
import { signIn } from '../TestUtils';

test.describe('Todo', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test.describe('Basic CRUD operations', () => {
    test('should return an error when creating a todo with missing data', async ({ page }) => {
      const createResponse = await page.request.post('/rpc/todo/create', {
        data: {
          json: {},
        },
      });

      expect(createResponse.status()).toBe(400);
    });

    test('should return an error when editing a non-existing todo', async ({ page }) => {
      const editResponse = await page.request.post('/rpc/todo/edit', {
        data: {
          json: {
            id: '123',
            title: faker.word.words(3),
            message: faker.word.words(10),
          },
        },
      });

      expect(editResponse.status()).toBe(404);
    });

    test('should return an error when deleting a non-existing todo', async ({ page }) => {
      const deleteResponse = await page.request.post('/rpc/todo/remove', {
        data: {
          json: {
            id: '123',
          },
        },
      });

      expect(deleteResponse.status()).toBe(404);
    });

    test('should create a new todo and edit it without error', async ({
      page,
    }) => {
      const createResponse = await page.request.post('/rpc/todo/create', {
        data: {
          json: {
            title: faker.word.words(3),
            message: faker.word.words(10),
          },
        },
      });
      const createJson = (await createResponse.json()).json;

      expect(createResponse.status()).toBe(200);
      expect(createJson.id).toBeDefined();

      const editResponse = await page.request.post('/rpc/todo/edit', {
        data: {
          json: {
            id: createJson.id,
            title: faker.word.words(3),
            message: faker.word.words(10),
          },
        },
      });

      expect(editResponse.status()).toBe(200);
    });

    test('should create a new todo and delete it without error', async ({
      page,
    }) => {
      const createResponse = await page.request.post('/rpc/todo/create', {
        data: {
          json: {
            title: faker.word.words(3),
            message: faker.word.words(10),
          },
        },
      });
      const createJson = (await createResponse.json()).json;

      expect(createResponse.status()).toBe(200);
      expect(createJson.id).toBeDefined();

      const deleteResponse = await page.request.post('/rpc/todo/remove', {
        data: {
          json: {
            id: createJson.id,
          },
        },
      });

      expect(deleteResponse.status()).toBe(200);
    });
  });
});
