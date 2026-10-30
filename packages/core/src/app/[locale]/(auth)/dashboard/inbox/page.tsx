import type { InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { Inbox as InboxIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { PageViewContext } from '@/features/dashboard/context/PageViewContext';
import { InboxControls } from '@/features/dashboard/inbox/InboxControls';
import { InboxList } from '@/features/dashboard/inbox/InboxList';
import { contextLine } from '@/features/dashboard/inbox/inboxMeta';
import { REVIEW_LIVE_EVERY_MS, REVIEW_LIVE_TOPICS } from '@/features/dashboard/inbox/live';
import { reviewPageView } from '@/features/dashboard/inbox/pageView';
import { RecommendationBatches } from '@/features/dashboard/inbox/RecommendationBatches';
import { defaultSortFor } from '@/features/dashboard/inbox/searchParams';
import { LiveRefresh } from '@/features/dashboard/LiveRefresh';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { INBOX_SORTS, INBOX_TABS, isInboxKind, listInbox } from '@/services/InboxService';
import { recommendationBatches } from '@/services/needsYou/batches';
import { listTeamAgents } from '@/services/TeamService';

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
 *
 * The URL workspace is the only scope. Legacy `scope` and `workspace`
 * parameters are ignored; membership elsewhere never broadens this queue.
 */

export const dynamic = 'force-dynamic';

type Params = { tab?: string; q?: string; sort?: string; kind?: string; actionKind?: string; agents?: string; scope?: string; workspace?: string };

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
  const sort = ((INBOX_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort : defaultSortFor(tab)) as InboxSort;
  const kinds = list(sp.kind).filter(isInboxKind) as InboxKind[];
  const actionKinds = list(sp.actionKind);
  const agents = list(sp.agents);
  const q = sp.q?.trim() ?? '';

  const [inbox, teamAgents] = await Promise.all([listInbox(orgId, { tab, q, sort, kinds, actionKinds, agents }), listTeamAgents(orgId)]);
  // One lookup for the whole page: who each row is about, drawn as its AgentDot.
  const agentsBySlug = Object.fromEntries(teamAgents.map(a => [a.slug, { name: a.name, accent: a.accent }]));
  // The decisions in view that recommend the same thing, gathered so they
  // can be accepted in one move (`services/needsYou/batches.ts`).
  const batches = tab === 'open' ? await recommendationBatches(orgId, inbox.items) : [];
  const open = inbox.tabs.open;
  // The oldest open row regardless of the current sort or filters: the queue's real age.
  const oldest = tab === 'open' ? inbox.items.reduce<Date | undefined>((m, i) => (m === undefined || i.at < m ? i.at : m), undefined) : undefined;
  const filtered = Boolean(q || kinds.length || actionKinds.length || agents.length);
  // What is on screen, for the chat beside the queue: "these" binds to it.
  const view = reviewPageView({ scope: 'here', tab, shown: inbox.total, tabs: inbox.tabs, failed: inbox.failedOpen, oldest, kinds, agents, q, batch: batches[0] ? { label: batches[0].label, count: batches[0].count } : null });

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageViewContext title={view.title} state={view.state} />
      {/* Live: a decline from chat, a teammate's answer or a new proposal re-reads the page in place (`LiveRefresh`). */}
      <TitleBar title="Review queue" description={<span data-testid="inbox-context">{contextLine(tab, open, oldest, inbox.total, inbox.failedOpen)}</span>} actions={<LiveRefresh everyMs={REVIEW_LIVE_EVERY_MS} follow={REVIEW_LIVE_TOPICS} />} />

      <div className="mb-4 space-y-3">
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
                  ? 'Nothing is waiting on you; anything an agent needs you to decide lands here.'
                  : tab === 'snoozed'
                    ? 'Recommendations you snooze wait here until their time comes.'
                    : 'Answered asks, decided recommendations and adopted rules will be listed here, newest first.'}
              action={filtered ? { label: 'Clear filters', href: tab === 'open' ? '/dashboard/inbox' : `/dashboard/inbox?tab=${tab}` } : { label: 'See what the team did', href: '/dashboard/activity' }}
            />
          )
        : (
            <>
              <RecommendationBatches batches={batches} />
              <InboxList inbox={inbox} tab={tab} agents={agentsBySlug} />
            </>
          )}
    </div>
  );
}
