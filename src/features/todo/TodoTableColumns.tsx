'use client';

import { useTranslations } from 'next-intl';

import { DataTable } from '@/components/ui/data-table';
import type { Todo } from '@/types/Todo';

import { ActionCell } from './ActionTodoTable';

export const TodoTableColumns = (props: {
  data: Todo[];
}) => {
  const t = useTranslations('TodoTableColumns');

  const columns = [
    {
      accessorKey: 'title',
      header: t('title_header'),
    },
    {
      accessorKey: 'message',
      header: t('message_header'),
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ActionCell,
    },
  ];

  return <DataTable columns={columns} data={props.data} />;
};
