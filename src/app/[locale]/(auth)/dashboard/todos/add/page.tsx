import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { AddTodoForm } from '@/features/todo/AddTodoForm';

export default async function AddTodoPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({
    locale,
    namespace: 'AddTodo',
  });

  return (
    <>
      <TitleBar title={t('title_bar')} />

      <DashboardSection
        title={t('add_todo_section_title')}
        description={t('add_todo_section_description')}
      >
        <AddTodoForm />
      </DashboardSection>
    </>
  );
};
