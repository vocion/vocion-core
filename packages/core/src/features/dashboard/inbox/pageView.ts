import type { InboxKind, InboxTab } from '@/services/InboxService';
import { openCountLine } from '@/services/inbox/openCount';
import { INBOX_KIND_META } from './inboxMeta';

/**
 * WHAT THE REVIEW QUEUE SHOWS, AS THE DOCK SENDS IT (2026-10-23). The chat
 * beside the queue knew only the path, so "these old recommendations" bound
 * to nothing and the agent called the queue "your inbox". The page declares
 * its name and what is on screen: the scope, the tab and its count, the
 * oldest wait, the filters and the batch on top. At most eight pairs
 * (`services/chat/pageContext.ts` keeps eight). Pure.
 * @param v - What the page rendered.
 * @param v.scope - This workspace, or every workspace the person reaches.
 * @param v.tab - The tab that is open.
 * @param v.shown - Rows in view, after filters.
 * @param v.tabs - Rows per tab.
 * @param v.failed - Of the open rows, the failed runs to retry or dismiss (the rest are the badge's decisions).
 * @param v.oldest - When the oldest open row started waiting, when the open tab is shown.
 * @param v.kinds - Kind chips that are on.
 * @param v.agents - Agent filters that are on.
 * @param v.q - The search text.
 * @param v.batch - The largest same-recommendation batch on top, when there is one.
 * @param v.batch.label - What it recommends ("Approve").
 * @param v.batch.count - How many.
 * @param now - The clock.
 */
export function reviewPageView(v: {
  scope: 'here' | 'all';
  tab: InboxTab;
  shown: number;
  tabs?: Partial<Record<InboxTab, number>>;
  failed?: number;
  oldest?: Date;
  kinds?: readonly InboxKind[];
  agents?: readonly string[];
  q?: string;
  batch?: { label: string; count: number } | null;
}, now: Date = new Date()): { title: string; state: Array<{ label: string; value: string }> } {
  const filters = [
    ...(v.kinds ?? []).map(k => INBOX_KIND_META[k]?.plural ?? k),
    ...(v.agents ?? []).map(a => `from ${a}`),
    ...(v.q ? [`matching "${v.q}"`] : []),
  ];
  const state = [
    { label: 'Scope', value: v.scope === 'all' ? 'All workspaces' : 'This workspace' },
    { label: 'Tab', value: v.tab === 'open' ? 'Open' : v.tab === 'decided' ? 'Decided' : 'Snoozed' },
    { label: 'Shown', value: `${v.shown} ${v.shown === 1 ? 'decision' : 'decisions'}` },
    ...(v.tabs ? [{ label: 'Tabs', value: `Open ${v.tabs.open ?? 0}${v.failed ? ` (${openCountLine(v.tabs.open ?? 0, v.failed)})` : ''} · Decided ${v.tabs.decided ?? 0} · Snoozed ${v.tabs.snoozed ?? 0}` }] : []),
    ...(v.oldest ? [{ label: 'Oldest waiting', value: `${Math.floor((now.getTime() - v.oldest.getTime()) / 86_400_000)}d` }] : []),
    { label: 'Filters', value: filters.length > 0 ? filters.join(', ') : 'none' },
    ...(v.batch ? [{ label: 'On top', value: `${v.batch.count} recommend "${v.batch.label}" (Accept all ${v.batch.count})` }] : []),
  ];
  return { title: 'Review queue', state: state.slice(0, 8) };
}
