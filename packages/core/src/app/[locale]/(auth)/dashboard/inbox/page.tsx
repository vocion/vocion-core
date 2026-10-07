import type { InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { Inbox as InboxIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { InboxControls } from '@/features/dashboard/inbox/InboxControls';
import { InboxList } from '@/features/dashboard/inbox/InboxList';
import { contextLine } from '@/features/dashboard/inbox/inboxMeta';
import { InboxScope } from '@/features/dashboard/inbox/InboxScope';
import { defaultSortFor } from '@/features/dashboard/inbox/searchParams';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listInboxForUser } from '@/services/inbox/acrossWorkspaces';
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
 *
 * `?scope=all` is the same queue across every workspace the person reaches,
 * their own rows first (`services/inbox/acrossWorkspaces.ts`), with one chip
 * per workspace (`?workspace=<id>`). Rows from another workspace open there.
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

  if (sp.scope === 'all') {
    const { userId } = await auth();
    return <AllWorkspaces userId={userId ?? ''} orgId={orgId} workspace={sp.workspace?.trim() || undefined} />;
  }

  const tab = ((INBOX_TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab : 'open') as InboxTab;
  const sort = ((INBOX_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort : defaultSortFor(tab)) as InboxSort;
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

      <div className="mb-4 space-y-3">
        <InboxScope scope="here" />
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
                  ? 'Recommendations, rulings, approvals, merges, credentials, choices and stopped runs land here as the team works. Nothing is waiting right now.'
                  : tab === 'snoozed'
                    ? 'Recommendations you snooze wait here until their time comes.'
                    : 'Answered asks, decided recommendations and adopted rules will be listed here, newest first.'}
              action={filtered ? { label: 'Clear filters', href: tab === 'open' ? '/dashboard/inbox' : `/dashboard/inbox?tab=${tab}` } : { label: 'See what the team did', href: '/dashboard/activity' }}
            />
          )
        : <InboxList inbox={inbox} tab={tab} />}
    </div>
  );
}

/**
 * The queue across every workspace the person reaches: the open tab only, their
 * own rows first, each tagged with its workspace.
 * @param props
 * @param props.userId - The person.
 * @param props.orgId - The workspace the page runs in; its rows still decide in place.
 * @param props.workspace - The workspace chip that is on, if any.
 */
async function AllWorkspaces({ userId, orgId, workspace }: { userId: string; orgId: string; workspace?: string }) {
  const cross = await listInboxForUser(userId, workspace ? { workspaceId: workspace } : {});
  const places = cross.workspaces.filter(w => w.count > 0).length;
  const line = cross.total === 0
    ? 'Nothing is waiting on you in any workspace.'
    : `${cross.total} ${cross.total === 1 ? 'decision' : 'decisions'} across ${places} ${places === 1 ? 'workspace' : 'workspaces'}${cross.yours > 0 ? `, ${cross.yours} yours` : ''}.`;
  return (
    <div className="mx-auto w-full max-w-5xl">
      <TitleBar title="Review queue" description={<span data-testid="inbox-context">{line}</span>} />
      <div className="mb-4">
        <InboxScope scope="all" workspace={workspace} total={cross.total} workspaces={cross.workspaces.map(w => ({ id: w.id, name: w.name, count: w.count, kind: w.kind }))} />
      </div>
      {cross.unavailable.length > 0 && (
        <p role="status" className="mb-3 text-[13px] text-muted-foreground">
          {`Could not read ${cross.unavailable.map(u => `${u.workspace.name} (${u.reason})`).join(', ')}; the list leaves them out.`}
        </p>
      )}
      {cross.items.length === 0
        ? <EmptyState icon={InboxIcon} title="All clear" description="Nothing is waiting on you in these workspaces right now." />
        : <InboxList inbox={cross} tab="open" workspaceId={orgId} />}
      {cross.workspaces.some(w => w.capped && (!workspace || w.id === workspace)) && (
        <p className="mt-3 text-[13px] text-muted-foreground">Busy workspaces show their first rows here; open a workspace for the rest.</p>
      )}
    </div>
  );
}
