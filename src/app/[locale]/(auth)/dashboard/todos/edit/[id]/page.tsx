import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { EditTodoForm } from '@/features/todo/EditTodoForm';
import { getTodo } from '@/services/TodoService';
import { ORG_ROLE } from '@/types/Auth';

const EditTodoPage = async (props: {
  params: { id: number; locale: string };
}) => {
  const { orgId, has } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  if (!has({ role: ORG_ROLE.ADMIN })) {
    redirect('/dashboard/todos');
  }

  const todo = await getTodo(props.params.id, orgId);

  if (!todo) {
    redirect('/dashboard/todos');
  }

  const t = await getTranslations({
    locale: props.params.locale,
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

export default EditTodoPage;
