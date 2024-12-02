import type { Todo } from '@/types/Todo';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProtectFallback } from '@/features/auth/ProtectFallback';
import { ORG_ROLE } from '@/types/Auth';
import { Protect } from '@clerk/nextjs';
import { DotsHorizontalIcon } from '@radix-ui/react-icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export const ActionCell = ({ row }: { row: { original: Todo } }) => {
  const router = useRouter();
  const t = useTranslations('TodoTableColumns');
  const todo = row.original;

  const trigger = (
    <Button variant="ghost" className="size-8 p-0 focus-visible:ring-offset-0">
      <span className="sr-only">{t('open_menu')}</span>
      <DotsHorizontalIcon className="size-4" />
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
            await fetch(`/api/todos`, {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                id: todo.id,
              }),
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
    <div className="flex items-center justify-end">
      <Protect
        role={ORG_ROLE.ADMIN}
        fallback={<ProtectFallback trigger={trigger} />}
      >
        {actionMenu}
      </Protect>
    </div>
  );
};
