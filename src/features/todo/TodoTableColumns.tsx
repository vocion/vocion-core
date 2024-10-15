'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { useFormatter, useTranslations } from 'next-intl';

import { DataTable } from '@/components/ui/data-table';
import type { Todo } from '@/types/Todo';

import { ActionCell } from './ActionTodoTable';

export const TodoTableColumns = (props: {
  data: Todo[];
}) => {
  const t = useTranslations('TodoTableColumns');
  const format = useFormatter();

  const columns: ColumnDef<Todo, string>[] = [
    {
      accessorKey: 'title',
      header: t('title_header'),
    },
    {
      accessorKey: 'message',
      header: t('message_header'),
    },
    {
      accessorFn: row => format.dateTime(row.createdAt, {
        dateStyle: 'full',
        timeStyle: 'medium',
      }),
      header: t('created_at_header'),
    },
    {
      id: 'actions',
      enableHiding: false,
      cell: ActionCell,
    },
  ];

  return <DataTable columns={columns} data={props.data} />;
};
