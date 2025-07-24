import { auth } from '@clerk/nextjs/server';
import { ORPCError, os } from '@orpc/server';
import { headers } from 'next/headers';
import { logger } from '@/libs/Logger';
import { createTodo, updateTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';
import { EditTodoValidation, TodoValidation } from '@/validations/TodoValidation';

export const ping = os
  .use(async ({ next }) => next({
    context: {
      headers: await headers(),
    },
  }))
  .handler(async () => {
    logger.info('Counter has been incremented');

    return {
      hello: 'world',
    };
  });

export const create = os
  .input(TodoValidation)
  .handler(async ({ input }) => {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      throw new ORPCError('Unauthorized', { status: 401 });
    }

    const todo = await createTodo(input, orgId);

    logger.info('A new todo has been created');

    return {
      id: todo[0]?.id,
    };
  });

export const edit = os
  .input(EditTodoValidation)
  .handler(async ({ input }) => {
    const { userId, orgId, has } = await auth();

    if (!userId || !orgId) {
      throw new ORPCError('Unauthorized', { status: 401 });
    }

    if (!has({ role: ORG_ROLE.ADMIN })) {
      throw new ORPCError('Forbidden', { status: 403 });
    }

    const result = await updateTodo(input, orgId);

    if (result.length === 0) {
      throw new ORPCError('Todo not found', { status: 404 });
    }

    logger.info('A todo has been updated');

    return {};
  });
