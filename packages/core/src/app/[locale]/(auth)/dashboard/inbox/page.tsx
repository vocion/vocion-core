import type { InboxGroup } from '@/services/InboxService';
import { Inbox as InboxIcon } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { InboxList } from '@/features/dashboard/inbox/InboxList';
import { INBOX_GROUP_META, waitingFor } from '@/features/dashboard/inbox/inboxMeta';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { activityFeed } from '@/services/ActivityService';
import { INBOX_GROUPS, needsYou } from '@/services/InboxService';

/**
 * Needs you — everything waiting on a person, in one column, longest-waiting
 * first: rulings, approvals, merges, inputs, recommendations, gates, runs
 * that stopped, suggested rules. Built to be worked from a phone: asks and
 * decision sheets open here as one-question-per-screen; everything else
 * links to the surface that decides it.
 */

export const dynamic = 'force-dynamic';

export default async function InboxPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ group?: string }>;
}) {
  const { locale } = await props.params;
  const { group } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return <TitleBar title="Needs you" description="Sign in to an organization to see what is waiting on you." />;
  }

  const [inbox, recent] = await Promise.all([needsYou(orgId), activityFeed(orgId, { limit: 3 })]);
  const oldest = inbox.items[0];
  const active = (group && (INBOX_GROUPS as readonly string[]).includes(group) ? group : null) as InboxGroup | null;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <TitleBar title="Needs you" />
      {/* The three questions the manifesto says a screen must answer, one line
          each: what needs me, what changed, what happens next. */}
      <dl className="mb-5 grid gap-x-6 gap-y-2 rounded-md border border-border px-4 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What needs me</dt>
          <dd className="mt-0.5">
            {inbox.total === 0 ? 'Nothing right now.' : `${inbox.total} ${inbox.total === 1 ? 'decision' : 'decisions'}${oldest ? `, oldest waiting ${waitingFor(oldest.at)}` : ''}.`}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What changed</dt>
          <dd className="mt-0.5 truncate">
            {recent[0]
              ? (
                  <Link href={recent[0].href} className="underline-offset-2 hover:underline">
                    {`${recent[0].title} · ${waitingFor(recent[0].at)} ago`}
                  </Link>
                )
              : 'No activity yet.'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What happens next</dt>
          <dd className="mt-0.5">
            {inbox.total === 0
              ? 'The team keeps working; new asks land here.'
              : oldest?.kind === 'sheet'
                ? `Answer the ${oldest.count ?? 0}-question sheet and the team picks up your answers on its next cycle.`
                : 'Answer the oldest first; each answer is read by the team on its next cycle.'}
          </dd>
        </div>
      </dl>

      {inbox.total > 0 && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip href="/dashboard/inbox" active={!active}>{`All · ${inbox.total}`}</Chip>
          {INBOX_GROUPS.filter(g => inbox.counts[g] > 0).map(g => (
            <Chip key={g} href={`/dashboard/inbox?group=${g}`} active={active === g}>
              {`${INBOX_GROUP_META[g].label} · ${inbox.counts[g]}`}
            </Chip>
          ))}
        </div>
      )}

      {inbox.total === 0
        ? (
            <EmptyState
              icon={InboxIcon}
              title="All clear"
              description="Rulings, approvals, merges, credentials, recommendations and stopped runs land here as the team works. Nothing is waiting right now."
              action={{ label: 'See what the team did', href: '/dashboard/activity' }}
            />
          )
        : <InboxList inbox={inbox} only={active} />}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-9 shrink-0 items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </Link>
  );
}
