import { faker } from '@faker-js/faker';
import { expect, test } from '@playwright/test';

import { AUTH_FILE } from '../TestUtils';

test.use({ storageState: AUTH_FILE });

test.describe('Todo', () => {
  test.describe('Basic CRUD operations', () => {
    test('should create a new todo and edit it without error', async ({
      request,
    }) => {
      const createResponse = await request.post('/api/todo', {
        data: {
          title: faker.word.words(3),
          message: faker.word.words(10),
        },
      });
      const createJson = await createResponse.json();

      expect(createResponse.status()).toBe(200);
      expect(createJson.id).toBeDefined();

      const editResponse = await request.put('/api/todo', {
        data: {
          id: createJson.id,
          title: faker.word.words(3),
          message: faker.word.words(10),
        },
      });

      expect(editResponse.status()).toBe(200);
    });

    test('should create a new todo and delete it without error', async ({
      request,
    }) => {
      const createResponse = await request.post('/api/todo', {
        data: {
          title: faker.word.words(3),
          message: faker.word.words(10),
        },
      });
      const createJson = await createResponse.json();

      expect(createResponse.status()).toBe(200);
      expect(createJson.id).toBeDefined();

      const deleteResponse = await request.delete('/api/todo', {
        data: {
          id: createJson.id,
        },
      });

      expect(deleteResponse.status()).toBe(200);
    });
  });
});
