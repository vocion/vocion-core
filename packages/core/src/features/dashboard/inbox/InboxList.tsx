import type { Inbox, InboxTab } from '@/services/InboxService';
import { InboxRow } from './InboxRow';

/**
 * The "Needs you" list: ONE flat queue in the sort the person picked (oldest
 * first by default), hairline dividers, 44px rows, a quiet column header for
 * the numbers. Kinds are told apart by the chip on each row and filtered by
 * the chips above the list — sections would break the queue order the page
 * promises.
 * @param props
 * @param props.inbox
 * @param props.tab
 */
export function InboxList({ inbox, tab }: { inbox: Inbox; tab: InboxTab }) {
  return (
    <div>
      <div className="mb-1 hidden items-center gap-3 px-3 text-[11px] text-muted-foreground/70 md:flex">
        <span className="min-w-0 flex-1" />
        <span className="w-12 text-right">conf.</span>
        <span className="w-20 text-right">amount</span>
        <span className="w-12 text-right">{tab === 'decided' ? 'when' : 'age'}</span>
        <span className="w-[76px]" />
      </div>
      <ul className="divide-y divide-border border-y border-border" data-testid="inbox-list">
        {inbox.items.map(item => <InboxRow key={item.key} item={item} tab={tab} />)}
      </ul>
    </div>
  );
}
