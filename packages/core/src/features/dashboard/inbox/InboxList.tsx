import type { Inbox, InboxGroup, InboxTab } from '@/services/InboxService';
import { INBOX_GROUPS } from '@/services/InboxService';
import { INBOX_GROUP_META } from './inboxMeta';
import { InboxRow } from './InboxRow';

/**
 * The "Needs you" list: one section per group, hairline dividers, 44px rows.
 * On the decided and snoozed tabs there is one flat list — grouping by kind
 * is for deciding, not for reading history.
 * @param props
 * @param props.inbox
 * @param props.tab
 * @param props.only - Show one group only (the chip filter).
 */
export function InboxList({ inbox, tab, only }: { inbox: Inbox; tab: InboxTab; only?: InboxGroup | null }) {
  if (tab !== 'open') {
    return (
      <ul className="divide-y divide-border border-y border-border">
        {inbox.items.map(item => <InboxRow key={item.key} item={item} tab={tab} />)}
      </ul>
    );
  }
  const groups = INBOX_GROUPS.filter(g => (only ? g === only : true) && inbox.counts[g] > 0);
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const meta = INBOX_GROUP_META[group];
        const Icon = meta.icon;
        return (
          <section key={group} aria-labelledby={`inbox-${group}`}>
            <div className="mb-1 flex items-center gap-2 px-3">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              <h2 id={`inbox-${group}`} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{meta.label}</h2>
              <span className="text-xs text-muted-foreground/70 tabular-nums">{inbox.counts[group]}</span>
              <span className="ml-auto hidden text-[11px] text-muted-foreground/70 md:flex md:gap-3">
                <span className="w-12 text-right">conf.</span>
                <span className="w-20 text-right">amount</span>
                <span className="w-12 text-right">age</span>
                <span className="w-[76px]" />
              </span>
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {inbox.items.filter(i => i.group === group).map(item => <InboxRow key={item.key} item={item} tab={tab} />)}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
