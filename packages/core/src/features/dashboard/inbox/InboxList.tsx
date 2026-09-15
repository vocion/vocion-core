import type { Inbox, InboxGroup, InboxItem } from '@/services/InboxService';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Link } from '@/libs/I18nNavigation';
import { INBOX_GROUPS } from '@/services/InboxService';
import { INBOX_GROUP_META, KIND_LABEL, riskTone, waitingFor } from './inboxMeta';

/**
 * The "Needs you" list: one section per group, longest-waiting first, one
 * column. A row is title + kind chip + who asked + age + risk and nothing
 * else — the question itself is read on its own screen. An ask or a decision
 * sheet opens here; a review item, a run, a suggested rule go to their native
 * surface.
 * @param props
 * @param props.inbox
 * @param props.only - Show one group only (the chip filter).
 */
export function InboxList({ inbox, only }: { inbox: Inbox; only?: InboxGroup | null }) {
  const groups = INBOX_GROUPS.filter(g => (only ? g === only : true) && inbox.counts[g] > 0);
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const meta = INBOX_GROUP_META[group];
        const Icon = meta.icon;
        return (
          <section key={group} aria-labelledby={`inbox-${group}`}>
            <div className="mb-1.5 flex items-center gap-2 px-1">
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <h2 id={`inbox-${group}`} className="text-sm font-semibold">{meta.label}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{inbox.counts[group]}</span>
            </div>
            <div className="rounded-md border border-border">
              {inbox.items.filter(i => i.group === group).map(item => <Row key={item.key} item={item} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Row({ item }: { item: InboxItem }) {
  const opensHere = item.kind === 'sheet' || item.askId !== undefined;
  const who = item.agentSlug ?? (item.teamSlug ? `team ${item.teamSlug}` : null);
  return (
    <Link
      href={item.href}
      className="flex min-h-14 items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-0 hover:bg-muted/40 active:bg-muted/60"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-snug font-medium">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium">{KIND_LABEL[item.kind] ?? item.kind}</span>
          {item.kind === 'sheet' && item.count ? <span>{`${item.count} questions`}</span> : null}
          {who && <span className="truncate">{who}</span>}
          <span className="tabular-nums" title={item.at.toLocaleString()}>{waitingFor(item.at)}</span>
        </span>
      </span>
      {item.risk && (
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase ${riskTone(item.risk)}`}>
          {item.risk}
        </span>
      )}
      {opensHere
        ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        : <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </Link>
  );
}
