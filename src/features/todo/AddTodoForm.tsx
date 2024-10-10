'use client';

import { useRouter } from 'next/navigation';
import type { SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';

import type { TodoValidation } from '@/validations/TodoValidation';

import { TodoForm } from './TodoForm';

export const AddTodoForm = () => {
  const router = useRouter();

  const onValid: SubmitHandler<z.infer<typeof TodoValidation>> = async (
    data,
  ) => {
    await fetch(`/api/todos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    router.push('/dashboard/todos');
    router.refresh();
  };

  return <TodoForm onValid={onValid} />;
};
