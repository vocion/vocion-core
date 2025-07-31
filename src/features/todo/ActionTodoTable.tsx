import type { Row } from '@tanstack/react-table';
import type { Todo } from '@/types/Todo';
import { Protect } from '@clerk/nextjs';
import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ProtectFallback } from '@/features/auth/ProtectFallback';
import { client } from '@/libs/Orpc';
import { ORG_ROLE } from '@/types/Auth';

export const ActionCell = (props: { row: Row<Todo> }) => {
  const router = useRouter();
  const t = useTranslations('TodoTableColumns');
  const todo = props.row.original;

  const trigger = (
    <Button variant="ghost">
      <span className="sr-only">{t('open_menu')}</span>
      <DotsHorizontalIcon />
    </Button>
  );

  const actionMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/todos/edit/${todo.id}`}>{t('edit')}</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive"
          onClick={async () => {
            await client.todo.remove({
              id: todo.id,
            });

            router.refresh();
          }}
        >
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-10 items-center justify-end">
      <Protect
        role={ORG_ROLE.ADMIN}
        fallback={<ProtectFallback trigger={trigger} />}
      >
        {actionMenu}
      </Protect>
    </div>
  );
};
