'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type SubmitHandler } from 'react-hook-form';
import type { z } from 'zod';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TodoForm } from '@/features/todo/TodoForm';
import type { TodoValidation } from '@/validations/TodoValidation';

const AddTodoPage = () => {
  const router = useRouter();
  const t = useTranslations('AddTodo');

  const onValid: SubmitHandler<z.infer<typeof TodoValidation>> = async (
    data,
  ) => {
    await fetch(`/api/todo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    router.push('/dashboard/todos');
    router.refresh();
  };

  return (
    <>
      <TitleBar title={t('title_bar')} />

      <DashboardSection
        title={t('add_todo_section_title')}
        description={t('add_todo_section_description')}
      >
        <TodoForm onValid={onValid} />
      </DashboardSection>
    </>
  );
};

export default AddTodoPage;
