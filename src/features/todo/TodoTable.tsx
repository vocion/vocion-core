import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { DataTable } from '@/components/ui/data-table';
import { getTodoList } from '@/services/TodoService';

import { generateColumns } from './TodoTableColumns';

export const TodoTable = async () => {
  const { orgId } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const data = await getTodoList(orgId);
  const todoTableColumns = await generateColumns();

  return <DataTable columns={todoTableColumns} data={data} />;
};
