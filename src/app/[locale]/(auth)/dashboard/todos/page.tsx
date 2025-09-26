import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { TodoTable } from '@/features/todo/TodoTable';

export default async function TodosPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations({
    locale,
    namespace: 'Todos',
  });

  return (
    <>
      <TitleBar
        title={t('title_bar')}
        description={t('title_bar_description')}
      />

      <div className="flex justify-end">
        <Link href="/dashboard/todos/add">
          <Button size="sm">{t('add_todo_button')}</Button>
        </Link>
      </div>

      <div className="mt-5">
        <TodoTable />
      </div>
    </>
  );
};
