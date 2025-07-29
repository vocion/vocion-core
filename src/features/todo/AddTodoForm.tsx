'use client';

import type { SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';
import type { TodoValidation } from '@/validations/TodoValidation';
import { useRouter } from 'next/navigation';
import { client } from '@/libs/Orpc';
import { TodoForm } from './TodoForm';

export const AddTodoForm = () => {
  const router = useRouter();

  const onValid: SubmitHandler<z.infer<typeof TodoValidation>> = async (
    data,
  ) => {
    await client.todo.create(data);

    router.push('/dashboard/todos');
    router.refresh();
  };

  return <TodoForm onValid={onValid} />;
};
