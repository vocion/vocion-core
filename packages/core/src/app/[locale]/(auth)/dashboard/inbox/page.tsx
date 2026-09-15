import type { InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { Inbox as InboxIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { InboxControls } from '@/features/dashboard/inbox/InboxControls';
import { InboxList } from '@/features/dashboard/inbox/InboxList';
import { agoLabel, waitingFor } from '@/features/dashboard/inbox/inboxMeta';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { INBOX_SORTS, INBOX_TABS, isInboxKind, lastChange, listInbox } from '@/services/InboxService';

/**
 * Needs you — THE decision surface. Everything waiting on a person, in one
 * column: proposals (agent actions described for a person and grouped per
 * record), rulings, approvals, merges, inputs, credentials, gates,
 * recommendations, runs that stopped, suggested rules. Kind chips filter it;
 * tabs, search, sort and filters live in the URL. Every row opens a detail
 * screen under `/dashboard/inbox/…` that decides it.
 */

export const dynamic = 'force-dynamic';

type Params = { tab?: string; q?: string; sort?: string; kind?: string; actionKind?: string; agents?: string };

const CHANGE_VERB: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', answered: 'Answered', new: 'New' };

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
    return <TitleBar title="Needs you" description="Sign in to an organization to see what is waiting on you." />;
  }

  const tab = ((INBOX_TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab : 'open') as InboxTab;
  const sort = ((INBOX_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort : tab === 'decided' ? 'newest' : 'oldest') as InboxSort;
  const kinds = list(sp.kind).filter(isInboxKind) as InboxKind[];
  const actionKinds = list(sp.actionKind);
  const agents = list(sp.agents);
  const q = sp.q?.trim() ?? '';

  const [inbox, change] = await Promise.all([listInbox(orgId, { tab, q, sort, kinds, actionKinds, agents }), lastChange(orgId)]);
  const open = inbox.tabs.open;
  const oldest = tab === 'open' ? inbox.items[0] : undefined;
  const filtered = Boolean(q || kinds.length || actionKinds.length || agents.length);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <TitleBar title="Needs you" />

      {/* What needs me · What changed · What happens next — one line each. */}
      <dl className="mb-5 grid gap-x-8 gap-y-2 border-y border-border py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">What needs me</dt>
          <dd className="mt-0.5">
            {open === 0 ? 'Nothing right now.' : `${open} ${open === 1 ? 'decision' : 'decisions'}${oldest ? `, oldest waiting ${waitingFor(oldest.at)}` : ''}.`}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">What changed</dt>
          <dd className="mt-0.5 truncate">
            {change
              ? (
                  <Link href={change.href} className="underline-offset-2 hover:underline">
                    {`${CHANGE_VERB[change.verb]}: ${change.title} · ${agoLabel(change.at)}`}
                  </Link>
                )
              : 'No decisions yet.'}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">What happens next</dt>
          <dd className="mt-0.5">
            {open === 0
              ? 'The team keeps working; new decisions land here.'
              : oldest?.shape === 'sheet'
                ? `Open the ${oldest.count ?? 0}-item sheet at the top and decide them in one pass; each approval executes on submit.`
                : 'Decide the oldest first; approvals execute immediately, and every answer teaches the team what you would have done.'}
          </dd>
        </div>
      </dl>

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
