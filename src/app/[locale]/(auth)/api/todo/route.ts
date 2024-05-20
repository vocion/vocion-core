import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

import { logger } from '@/libs/Logger';
import { createTodo, deleteTodo, updateTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';
import {
  DeleteTodoValidation,
  EditTodoValidation,
  TodoValidation,
} from '@/validations/TodoValidation';

export const POST = async (request: Request) => {
  const { userId, orgId } = auth();

  if (!userId || !orgId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const json = await request.json();
  const parse = TodoValidation.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(parse.error.format(), { status: 422 });
  }

  try {
    const todo = await createTodo(parse.data, orgId);

    logger.info('A new todo has been created');

    return NextResponse.json({
      id: todo[0]?.id,
    });
  } catch (error) {
    logger.error(error, 'An error occurred while creating a todo');

    return NextResponse.json({}, { status: 500 });
  }
};

export const PUT = async (request: Request) => {
  const { userId, orgId, has } = auth();

  if (!userId || !orgId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (!has({ role: ORG_ROLE.ADMIN })) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const json = await request.json();
  const parse = EditTodoValidation.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(parse.error.format(), { status: 422 });
  }

  try {
    await updateTodo(parse.data, orgId);

    logger.info('A todo has been updated');

    return NextResponse.json({});
  } catch (error) {
    logger.error(error, 'An error occurred while updating a todo');

    return NextResponse.json({}, { status: 500 });
  }
};

export const DELETE = async (request: Request) => {
  const { userId, orgId, has } = auth();

  if (!userId || !orgId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (!has({ role: ORG_ROLE.ADMIN })) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const json = await request.json();
  const parse = DeleteTodoValidation.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(parse.error.format(), { status: 422 });
  }

  try {
    await deleteTodo(parse.data.id, orgId);

    logger.info('A todo entry has been deleted');

    return NextResponse.json({});
  } catch (error) {
    logger.error(error, 'An error occurred while deleting a todo');

    return NextResponse.json({}, { status: 500 });
  }
};
