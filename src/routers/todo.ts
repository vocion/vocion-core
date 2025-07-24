import { auth } from '@clerk/nextjs/server';
import { ORPCError, os } from '@orpc/server';
import { headers } from 'next/headers';
import { logger } from '@/libs/Logger';
import { createTodo } from '@/services/TodoService';
import { TodoValidation } from '@/validations/TodoValidation';

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
      throw new ORPCError('Unauthorized');
    }

    const todo = await createTodo(input, orgId);

    logger.info('A new todo has been created');

    return {
      id: todo[0]?.id,
    };
  });
