import { getTranslations } from 'next-intl/server';

import { ActionCell } from './ActionTodoTable';

export const generateColumns = async () => {
  const t = await getTranslations('TodoTableColumns');

  return [
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
};
