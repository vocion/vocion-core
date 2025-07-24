import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { EditTodoForm } from '@/features/todo/EditTodoForm';
import { getTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

export default async function EditTodoPage(props: {
  params: Promise<{ id: number; locale: string }>;
}) {
  const { orgId, has } = await requireOrganization();
  const { id, locale } = await props.params;

  if (!has({ role: ORG_ROLE.ADMIN })) {
    redirect('/dashboard/todos');
  }

  const todo = await getTodo(id, orgId);

  if (!todo) {
    redirect('/dashboard/todos');
  }

  const t = await getTranslations({
    locale,
    namespace: 'EditTodo',
  });

  return (
    <>
      <TitleBar title={t('title_bar')} />

      <DashboardSection
        title={t('edit_todo_section_title')}
        description={t('edit_todo_section_description')}
      >
        <EditTodoForm todo={todo} />
      </DashboardSection>
    </>
  );
};
