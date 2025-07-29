'use client';

import type { SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';
import type { EditTodoValidation, TodoValidation } from '@/validations/TodoValidation';
import { useRouter } from 'next/navigation';
import { client } from '@/libs/Orpc';
import { TodoForm } from './TodoForm';

export const EditTodoForm = (props: { todo: z.infer<typeof EditTodoValidation> }) => {
  const router = useRouter();

  const onValid: SubmitHandler<z.infer<typeof TodoValidation>> = async (
    data,
  ) => {
    await client.todo.edit({
      id: props.todo.id,
      ...data,
    });

    router.push('/dashboard/todos');
    router.refresh();
  };

  return <TodoForm defaultValues={props.todo} onValid={onValid} />;
};
