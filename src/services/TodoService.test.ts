import assert from 'node:assert';
import { faker } from '@faker-js/faker';
import { describe, expect, it, vi } from 'vitest';
import { createTodo, deleteTodo, getTodo, getTodoList, updateTodo } from './TodoService';

vi.mock('@/libs/DB');

describe('TodoService', () => {
  describe('CRUD operations', () => {
    it('should return an empty list when no todos exist', async () => {
      const org = faker.string.uuid();
      const result = await getTodoList(org);

      expect(result).toEqual([]);
    });

    it('should create a new todo and retrieve it successfully', async () => {
      const org = faker.string.uuid();
      const newTodo = {
        title: faker.word.words(3),
        message: faker.word.words(10),
      };

      const createResponse = await createTodo(newTodo, org);
      assert(createResponse[0] !== undefined, 'Todo creation failed');

      const getResponse = await getTodo(createResponse[0].id, org);
      assert(getResponse !== undefined, 'Todo retrieval failed');

      expect(getResponse.title).toEqual(newTodo.title);
      expect(getResponse.message).toEqual(newTodo.message);
    });

    it('should update an existing todo successfully', async () => {
      const org = faker.string.uuid();
      const originalTodo = {
        title: faker.word.words(3),
        message: faker.word.words(10),
      };

      // Create a todo first
      const createResponse = await createTodo(originalTodo, org);
      assert(createResponse[0] !== undefined, 'Todo creation failed');

      // Update the todo
      const updatedTodo = {
        id: createResponse[0].id,
        title: `[UPDATED] ${originalTodo.title}`,
        message: `[UPDATED] ${originalTodo.message}`,
      };

      const updateResponse = await updateTodo(updatedTodo, org);
      assert(updateResponse[0] !== undefined, 'Todo update failed');

      // Verify the update
      const getResponse = await getTodo(createResponse[0].id, org);
      assert(getResponse !== undefined, 'Todo retrieval after update failed');

      expect(getResponse.id).toEqual(createResponse[0].id);
      expect(getResponse.title).toEqual(updatedTodo.title);
      expect(getResponse.message).toEqual(updatedTodo.message);
    });

    it('should handle deletion of non-existing todo gracefully', async () => {
      const org = faker.string.uuid();
      const nonExistingTodoId = 99999;

      const deleteResponse = await deleteTodo(nonExistingTodoId, org);

      expect(deleteResponse).toEqual([]);
    });

    it('should delete an existing todo successfully', async () => {
      const org = faker.string.uuid();
      const newTodo = {
        title: faker.word.words(3),
        message: faker.word.words(10),
      };

      const createResponse = await createTodo(newTodo, org);
      assert(createResponse[0] !== undefined, 'Todo creation failed');

      // Delete the todo
      const deleteResponse = await deleteTodo(createResponse[0].id, org);
      assert(deleteResponse[0] !== undefined, 'Todo deletion failed');
    });
  });
});
