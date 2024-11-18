import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { AddTodoForm } from '@/features/todo/AddTodoForm';
import { useTranslations } from 'next-intl';

export default function AddTodoPage() {
  const t = useTranslations('AddTodo');

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
