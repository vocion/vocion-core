import assert from 'node:assert';
import { faker } from '@faker-js/faker';
import { describe, expect, it, vi } from 'vitest';
import { createTodo, getTodo, getTodoList } from './TodoService';

vi.mock('@/libs/DB');

describe('TodoService', () => {
  describe('CRUD operations', () => {
    it('should return a list with one todo', async () => {
      const org = faker.string.uuid();
      const result = await getTodoList(org);

      expect(result).toEqual([]);
    });

    it('should create a new todo and return it', async () => {
      const org = faker.string.uuid();
      const todoTitle = faker.word.words(3);
      const newTodo = {
        title: todoTitle,
        message: faker.word.words(10),
      };
      const createResponse = await createTodo(newTodo, org);
      assert(createResponse[0] !== undefined, 'Todo creation failed');

      const getResponse = await getTodo(createResponse[0].id, org);
      assert(getResponse !== undefined, 'Todo retrieval failed');

      expect(getResponse.title).toEqual(todoTitle);
    });
  });
});
