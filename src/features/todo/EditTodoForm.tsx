'use client';

import { useRouter } from 'next/navigation';
import type { SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';

import type {
  EditTodoValidation,
  TodoValidation,
} from '@/validations/TodoValidation';

import { TodoForm } from './TodoForm';

export const EditTodoForm = (props: { todo: z.infer<typeof EditTodoValidation> }) => {
  const router = useRouter();

  const onValid: SubmitHandler<z.infer<typeof TodoValidation>> = async (
    data,
  ) => {
    await fetch(`/api/todo`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: props.todo.id,
        ...data,
      }),
    });

    router.push('/dashboard/todos');
    router.refresh();
  };

  return <TodoForm defaultValues={props.todo} onValid={onValid} />;
};
