import type { Inbox, InboxTab } from '@/services/InboxService';
import { COLUMN, ListRows } from '@/components/patterns';
import { cn } from '@/utils/Helpers';
import { InboxRow } from './InboxRow';

/**
 * The "Review queue" list: ONE flat queue in the sort the person picked (oldest
 * first by default), hairline dividers, 44px rows, a quiet column header for
 * the numbers. Kinds are told apart by the chip on each row and filtered by
 * the chips above the list — sections would break the queue order the page
 * promises.
 *
 * The rows are `patterns/ListRow`, the same component every other list in the
 * app renders, so the header labels take their widths from `COLUMN` rather
 * than from numbers typed twice.
 * @param props
 * @param props.inbox
 * @param props.tab
 */
export function InboxList({ inbox, tab }: { inbox: Inbox; tab: InboxTab }) {
  return (
    <div data-testid="inbox-list">
      <div className="mb-1 hidden items-center gap-3 px-2 text-[11px] text-muted-foreground/70 sm:flex">
        <span className="min-w-0 flex-1" />
        {/* `COLUMN.score`, not `COLUMN.number` — the cell below is a score
            column and the header was half its width, so the label never sat
            over its own column. It names the class the bars are about, once. */}
        <span className={cn(COLUMN.score, 'text-right')}>recommendation</span>
        <span className={cn(COLUMN.amount, 'text-right')}>amount</span>
        <span className={cn(COLUMN.number, 'text-right')}>{tab === 'decided' ? 'when' : 'age'}</span>
        <span className="w-[76px]" />
      </div>
      <ListRows className="border-y border-border/70">
        {inbox.items.map(item => <InboxRow key={item.key} item={item} tab={tab} />)}
      </ListRows>
    </div>
  );
}
