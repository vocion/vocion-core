import type { RelatedItem } from '@/services/inbox/relatedItems';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

/**
 * The other open decisions about the same thread or record, one link each,
 * so one visit settles all of them (`services/inbox/relatedItems`). Nothing
 * related draws nothing.
 * @param props - The items.
 * @param props.items - The related open items.
 * @param props.className
 */
export function RelatedItems(props: { items: readonly RelatedItem[]; className?: string }) {
  if (props.items.length === 0) {
    return null;
  }
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]', props.className)} data-testid="related-items">
      <span className="text-muted-foreground">Also waiting:</span>
      {props.items.map(item => (
        <Link key={item.href} href={item.href} className="max-w-full truncate text-primary underline-offset-2 hover:underline" data-testid="related-item">
          {item.title}
        </Link>
      ))}
    </div>
  );
}
