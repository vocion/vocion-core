import { getTodoList } from '@/services/TodoService';
import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { TodoTableColumns } from './TodoTableColumns';

export const TodoTable = async () => {
  const { orgId } = await auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const data = await getTodoList(orgId);

  return <TodoTableColumns data={data} />;
};
