import type { InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { Inbox as InboxIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { InboxControls } from '@/features/dashboard/inbox/InboxControls';
import { InboxList } from '@/features/dashboard/inbox/InboxList';
import { contextLine } from '@/features/dashboard/inbox/inboxMeta';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { INBOX_SORTS, INBOX_TABS, isInboxKind, listInbox } from '@/services/InboxService';

/**
 * Review queue — THE decision surface. Everything waiting on a person, in one
 * column: proposals (agent actions described for a person and grouped per
 * record), rulings, approvals, merges, inputs, credentials, gates,
 * recommendations, runs that stopped, suggested rules. Kind chips filter it;
 * tabs, search, sort and filters live in the URL. Every row opens a detail
 * screen under `/dashboard/inbox/…` that decides it.
 *
 * The header is one line — "136 decisions, oldest waiting 53d." — under the
 * headline (Chris, 2026-09-15: "probably the only context we need"). What
 * changed is said by the toast that follows each decision, not by a
 * standing column.
 */

export const dynamic = 'force-dynamic';

type Params = { tab?: string; q?: string; sort?: string; kind?: string; actionKind?: string; agents?: string };

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

export default async function InboxPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Params>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return <TitleBar title="Review queue" description="Sign in to an organization to see what is waiting on you." />;
  }

  const tab = ((INBOX_TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab : 'open') as InboxTab;
  const sort = ((INBOX_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort : tab === 'decided' ? 'newest' : 'oldest') as InboxSort;
  const kinds = list(sp.kind).filter(isInboxKind) as InboxKind[];
  const actionKinds = list(sp.actionKind);
  const agents = list(sp.agents);
  const q = sp.q?.trim() ?? '';

  const inbox = await listInbox(orgId, { tab, q, sort, kinds, actionKinds, agents });
  const open = inbox.tabs.open;
  // The oldest open row regardless of the current sort or filters: the queue's real age.
  const oldest = tab === 'open' ? inbox.items.reduce<Date | undefined>((m, i) => (m === undefined || i.at < m ? i.at : m), undefined) : undefined;
  const filtered = Boolean(q || kinds.length || actionKinds.length || agents.length);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <TitleBar title="Review queue" description={<span data-testid="inbox-context">{contextLine(tab, open, oldest, inbox.total)}</span>} />

      <div className="mb-4">
        <InboxControls tab={tab} q={q} sort={sort} kinds={kinds} actionKinds={actionKinds} agents={agents} facets={inbox.facets} counts={inbox.counts} tabs={inbox.tabs} />
      </div>

      {inbox.total === 0
        ? (
            <EmptyState
              icon={InboxIcon}
              title={filtered ? 'Nothing matches' : tab === 'open' ? 'All clear' : tab === 'snoozed' ? 'Nothing snoozed' : 'No decisions yet'}
              description={filtered
                ? 'Clear the search or a filter to see the rest.'
                : tab === 'open'
                  ? 'Proposals, rulings, approvals, merges, credentials, recommendations and stopped runs land here as the team works. Nothing is waiting right now.'
                  : tab === 'snoozed'
                    ? 'Proposals you snooze wait here until their time comes.'
                    : 'Answered asks, decided proposals and adopted rules will be listed here, newest first.'}
              action={filtered ? { label: 'Clear filters', href: tab === 'open' ? '/dashboard/inbox' : `/dashboard/inbox?tab=${tab}` } : { label: 'See what the team did', href: '/dashboard/activity' }}
            />
          )
        : <InboxList inbox={inbox} tab={tab} />}
    </div>
  );
}
