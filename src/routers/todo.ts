import type { OrgRole } from '@/types/Auth';
import { auth } from '@clerk/nextjs/server';
import { ORPCError, os } from '@orpc/server';
import { logger } from '@/libs/Logger';
import { createTodo, deleteTodo, updateTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';
import { DeleteTodoValidation, EditTodoValidation, TodoValidation } from '@/validations/TodoValidation';

// Authentication helper function
const requireAuth = async () => {
  const { userId, orgId, has } = await auth();

  if (!userId || !orgId) {
    throw new ORPCError('Unauthorized', { status: 401 });
  }

  return { orgId, has };
};

// Role-based authentication helper function
const requireRole = async (role: OrgRole) => {
  const { orgId, has } = await requireAuth();

  if (!has({ role })) {
    throw new ORPCError('Forbidden', { status: 403 });
  }

  return { orgId };
};

export const create = os
  .input(TodoValidation)
  .handler(async ({ input }) => {
    const { orgId } = await requireAuth();

    const todo = await createTodo(input, orgId);

    logger.info('A new todo has been created');

    return {
      id: todo[0]?.id,
    };
  });

export const edit = os
  .input(EditTodoValidation)
  .handler(async ({ input }) => {
    const { orgId } = await requireRole(ORG_ROLE.ADMIN);

    const result = await updateTodo(input, orgId);

    if (result.length === 0) {
      throw new ORPCError('Todo not found', { status: 404 });
    }

    logger.info('A todo has been updated');

    return {};
  });

export const remove = os
  .input(DeleteTodoValidation)
  .handler(async ({ input }) => {
    const { orgId } = await requireRole(ORG_ROLE.ADMIN);

    const result = await deleteTodo(input.id, orgId);

    if (result.length === 0) {
      throw new ORPCError('Todo not found', { status: 404 });
    }

    logger.info('A todo entry has been deleted');

    return {};
  });
