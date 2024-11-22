import { logger } from '@/libs/Logger';
import { createTodo, deleteTodo, updateTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';
import { DeleteTodoValidation, EditTodoValidation, TodoValidation } from '@/validations/TodoValidation';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export const POST = async (request: Request) => {
  const { userId, orgId } = await auth();

  if (!userId || !orgId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const json = await request.json();
  const parse = TodoValidation.safeParse(json);

  if (!parse.success) {
    return NextResponse.json(parse.error.format(), { status: 422 });
  }

  const todo = await createTodo(parse.data, orgId);

  logger.info('A new todo has been created');

  return NextResponse.json({
    id: todo[0]?.id,
  });
};

export const PUT = async (request: Request) => {
  const { userId, orgId, has } = await auth();

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

  const result = await updateTodo(parse.data, orgId);

  if (result.length === 0) {
    return NextResponse.json({}, { status: 404 });
  }

  logger.info('A todo has been updated');

  return NextResponse.json({});
};

export const DELETE = async (request: Request) => {
  const { userId, orgId, has } = await auth();

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

  const result = await deleteTodo(parse.data.id, orgId);

  if (result.length === 0) {
    return NextResponse.json({}, { status: 404 });
  }

  logger.info('A todo entry has been deleted');

  return NextResponse.json({});
};
