import type { ActivityItem, ActivityKind } from '@/services/ActivityService';
import { Activity as ActivityIcon, AlertTriangle, CalendarClock, Compass, Database, GitBranch, Zap } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { activityFeed, ATTENTION_STATUSES } from '@/services/ActivityService';

/**
 * Activity — the OBSERVE surface of the daily-driver hierarchy:
 * Chat (talk) · Review (decide) · Activity (observe) · Search (find).
 *
 * One reverse-chron stream of everything the team did — mission checks,
 * workflow runs, event fires, source syncs — with needs-attention pinned
 * on top and filter chips per kind. Definitions live in the Team catalogs;
 * this page answers "what did my team do overnight?"
 */

const KIND_META: Record<ActivityKind, { label: string; icon: typeof Compass }> = {
  mission: { label: 'Missions', icon: Compass },
  workflow: { label: 'Workflows', icon: GitBranch },
  event: { label: 'Events', icon: Zap },
  sync: { label: 'Syncs', icon: Database },
};

function statusTone(status: string): string {
  if (status === 'completed' || status === 'triggered') {
    return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  }
  if (ATTENTION_STATUSES.has(status)) {
    return 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
  if (status === 'cancelled' || status === 'no_match') {
    return 'bg-muted text-muted-foreground';
  }
  return 'bg-primary/10 text-primary';
}

function Row({ item }: { item: ActivityItem }) {
  const Icon = KIND_META[item.kind].icon;
  return (
    <Link href={item.href} className="flex items-center gap-3 border-b border-border py-2.5 text-sm last:border-0 hover:bg-muted/40">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.title}</span>
        {(item.detail || item.invokedBy) && (
          <span className="block truncate text-xs text-muted-foreground">
            {[item.invokedBy ? `by ${item.invokedBy}` : null, item.detail].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {item.at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusTone(item.status)}`}>
        {item.status.replaceAll('_', ' ')}
      </span>
    </Link>
  );
}

export default async function ActivityPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; slug?: string }>;
}) {
  const { locale } = await props.params;
  const { kind, slug } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }

  const activeKind = (kind && kind in KIND_META ? kind : null) as ActivityKind | null;
  // If narrowing to a specific definition, the DB does the filter (cheaper).
  // The unfiltered feed still fills the tab-chip counts.
  const [feed, all] = await Promise.all([
    activityFeed(orgId, { kind: activeKind ?? undefined, slug, limit: 50 }),
    slug ? activityFeed(orgId, { limit: 50 }) : Promise.resolve(null),
  ]);
  const chipSource = all ?? feed;
  const attention = feed.filter(i => ATTENTION_STATUSES.has(i.status));
  const counts = Object.fromEntries(
    (Object.keys(KIND_META) as ActivityKind[]).map(k => [k, chipSource.filter(i => i.kind === k).length]),
  ) as Record<ActivityKind, number>;
  const scopedTo = slug ? `${activeKind ? KIND_META[activeKind].label.replace(/s$/, '') : ''} “${slug}”`.trim() : null;

  return (
    <>
      <TitleBar
        title="Activity"
        description="Everything the team did — checks, runs, fires, and syncs — newest first. Decisions that need you live in Review."
      />

      {scopedTo && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Scoped to</span>
          <span className="font-medium">{scopedTo}</span>
          <Link href="/dashboard/activity" className="ml-auto text-muted-foreground underline hover:text-foreground">clear</Link>
        </div>
      )}

      {attention.length > 0 && (
        <section className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/5 p-5">
          <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-4 text-amber-600" />
            Needs attention
          </h2>
          {attention.slice(0, 8).map(item => <Row key={item.key} item={item} />)}
        </section>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/dashboard/activity"
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${!activeKind ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
        >
          All ·
          {' '}
          {chipSource.length}
        </Link>
        {(Object.keys(KIND_META) as ActivityKind[]).map(k => (
          <Link
            key={k}
            href={`/dashboard/activity?kind=${k}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activeKind === k ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {KIND_META[k].label}
            {' '}
            ·
            {' '}
            {counts[k]}
          </Link>
        ))}
      </div>

      {feed.length === 0
        ? (
            <EmptyState
              icon={ActivityIcon}
              title="Nothing yet"
              description="Runs, checks, event fires, and syncs will appear here as your team works — on its automations or on your briefs."
            />
          )
        : (
            <div className="rounded-md border border-border px-5 py-2">
              {feed.map(item => <Row key={item.key} item={item} />)}
            </div>
          )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        What's coming next lives under
        {' '}
        <Link href="/dashboard/automation" className="underline">Automation</Link>
        .
      </p>
    </>
  );
}
