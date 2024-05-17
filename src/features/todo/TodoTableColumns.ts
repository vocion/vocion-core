import { getTranslations } from 'next-intl/server';

import { ActionCell } from './ActionTodoTable';

export const generateColumns = async (locale: string) => {
  const t = await getTranslations({
    locale,
    namespace: 'TodoTableColumns',
  });

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
