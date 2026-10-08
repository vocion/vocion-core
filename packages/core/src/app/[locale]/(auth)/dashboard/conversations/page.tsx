import { MessagesSquare, Search } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { ConversationListRow } from '@/features/dashboard/chat/ConversationListRow';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { formatMoney } from '@/libs/workspace/pageFields';
import { centsOf } from '@/services/budget/runCost';
import { searchConversations } from '@/services/ConversationService';

export const dynamic = 'force-dynamic';

/**
 * Today / Yesterday / the date — the same buckets the rail's history uses.
 * @param when
 * @param now
 */
function bucketOf(when: Date, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(when)) / 86_400_000);
  if (days <= 0) {
    return 'Today';
  }
  if (days === 1) {
    return 'Yesterday';
  }
  if (days < 7) {
    return 'Earlier this week';
  }
  return when.toLocaleDateString(undefined, { month: 'long', year: when.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/**
 * What the thread's turns cost, for its row: nothing when no turn recorded a
 * cost (threads from before 2026-10-02), never a made-up $0.00.
 * @param microCents - The thread's recorded spend.
 */
function spentLabel(microCents: number | null): string {
  const cents = centsOf(microCents);
  return cents === null ? '' : ` · ${formatMoney(cents)}`;
}

/**
 * /dashboard/conversations — every thread in this workspace, newest first.
 *
 * The rail's "All conversations" pointed at `/dashboard/chat` until
 * 2026-09-15, which is a NEW chat: the one row promising a list delivered a
 * blank composer (Chris: "all conversations menu item goes to /chat — with no
 * list of chats"). A list is its own page, because finding a thread from
 * three weeks ago is a different job from having one.
 *
 * Record-scoped threads are per person, so this shows the workspace's
 * everything-scoped threads plus the viewer's own scoped ones — never someone
 * else's (agent-chat-surface.md §8.6).
 *
 * A row's name is the thread's title — the generated one once the first
 * reply has landed — and its pencil renames it in place (`ConversationListRow`).
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function ConversationsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { q = '' } = await props.searchParams;
  const session = await auth();
  const orgId = session.orgId;
  const rows = orgId
    ? await searchConversations({ orgId, q, limit: 100, includeScopedFor: session.userId ?? undefined })
    : [];

  const now = new Date();
  const groups: { label: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const label = bucketOf(row.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) {
      last.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }

  return (
    <>
      <TitleBar title="Conversations" description="Every thread in this workspace, newest first, ready to pick back up." />

      <form method="GET" className="mt-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search titles and messages"
          aria-label="Search conversations"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </form>

      {rows.length === 0
        ? (
            <div className="mt-8">
              <EmptyState
                icon={MessagesSquare}
                title={q ? 'No conversations match' : 'No conversations yet'}
                description={q ? 'Try a shorter term — search covers thread titles and message text.' : 'Every conversation with your agents is kept here, so you can pick it back up.'}
                {...(q ? {} : { action: { label: 'Start a conversation', href: '/dashboard/chat?new=1' } })}
              />
            </div>
          )
        : (
            <div className="mt-4 space-y-6">
              {groups.map(group => (
                <section key={group.label}>
                  <h2 className="px-1 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label}</h2>
                  <ul className="divide-y divide-border/70 rounded-lg border border-border">
                    {group.rows.map((row) => {
                      return (
                        <li key={row.id}>
                          <ConversationListRow
                            id={row.id}
                            title={row.title}
                            snippet={row.snippet}
                            meta={`${row.messageCount === 1 ? '1 message' : `${row.messageCount} messages`}${row.scopeRef ? ' · about a record' : ''}${spentLabel(row.microCents)}`}
                            time={row.updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                            surface={row.surface}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
    </>
  );
}
