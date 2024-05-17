import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { useLocale } from 'next-intl';

import { DataTable } from '@/components/ui/data-table';
import { getTodoList } from '@/services/TodoService';

import { generateColumns } from './TodoTableColumns';

const TodoTable = async () => {
  const { orgId } = auth();

  if (!orgId) {
    redirect('/onboarding/organization-selection');
  }

  const locale = useLocale();
  const data = await getTodoList(orgId);
  const todoTableColumns = await generateColumns(locale);

  return <DataTable columns={todoTableColumns} data={data} />;
};

export { TodoTable };
