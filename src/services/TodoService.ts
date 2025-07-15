import type { Todo } from '@/types/Todo';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { todoSchema } from '@/models/Schema';

export const getTodoList = (orgId: string) => {
  return db.query.todoSchema.findMany({
    where: eq(todoSchema.ownerId, orgId),
    columns: {
      id: true,
      title: true,
      message: true,
      createdAt: true,
    },
    orderBy: (todo, { asc }) => [asc(todo.createdAt)],
  });
};

export const createTodo = (todo: Omit<Todo, 'id' | 'createdAt'>, orgId: string) => {
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

export const updateTodo = (todo: Omit<Todo, 'createdAt'>, orgId: string) => {
  return db
    .update(todoSchema)
    .set(todo)
    .where(and(eq(todoSchema.id, todo.id), eq(todoSchema.ownerId, orgId)))
    .returning();
};

export const deleteTodo = (todoId: number, orgId: string) => {
  return db
    .delete(todoSchema)
    .where(and(eq(todoSchema.id, todoId), eq(todoSchema.ownerId, orgId)))
    .returning();
};
