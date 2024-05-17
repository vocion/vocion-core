import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/libs/DB';
import { todoSchema } from '@/models/Schema';
import type { Todo } from '@/types/Todo';

export const getTodoList = (orgId: string) => {
  return db.query.todoSchema.findMany({
    where: eq(todoSchema.ownerId, orgId),
    columns: {
      id: true,
      title: true,
      message: true,
    },
  });
};

export const createTodo = (todo: Omit<Todo, 'id'>, orgId: string) => {
  return db
    .insert(todoSchema)
    .values({ ...todo, ownerId: orgId })
    .returning();
};

export const getTodo = (todoId: number, orgId: string) => {
  return db.query.todoSchema.findFirst({
    where: and(eq(todoSchema.id, todoId), eq(todoSchema.ownerId, orgId)),
    columns: {
      id: true,
      title: true,
      message: true,
    },
  });
};

export const updateTodo = (todo: Todo, orgId: string) => {
  return db
    .update(todoSchema)
    .set({
      ...todo,
      updatedAt: sql`(strftime('%s', 'now'))`,
    })
    .where(and(eq(todoSchema.id, todo.id), eq(todoSchema.ownerId, orgId)))
    .run();
};

export const deleteTodo = (todoId: number, orgId: string) => {
  return db
    .delete(todoSchema)
    .where(and(eq(todoSchema.id, todoId), eq(todoSchema.ownerId, orgId)))
    .run();
};
