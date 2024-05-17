import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TodoTable } from '@/features/todo/TodoTable';

const TodosPage = async (props: { params: { locale: string } }) => {
  const t = await getTranslations({
    locale: props.params.locale,
    namespace: 'Todos',
  });

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <div className="flex justify-end">
        <Link href="/dashboard/add-todo">
          <Button size="sm">{t('add_todo_button')}</Button>
        </Link>
      </div>

      <div className="mt-2">
        <Suspense>
          <TodoTable />
        </Suspense>
      </div>
    </>
  );
};

export default TodosPage;
