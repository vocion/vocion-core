import { auth } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import { ExternalLink } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { FeedbackButtons } from '@/features/dashboard/FeedbackButtons';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { db } from '@/libs/DB';
import { Link } from '@/libs/I18nNavigation';
import { skillRunSchema, skillSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';
import { isRunStatus } from '@/types/Status';

type Row = {
  kind: 'skill' | 'workflow';
  id: number;
  slug: string;
  name: string | null;
  status: string | null;
  rating: 'up' | 'down' | null;
  contextSha: string | null;
  createdBy: string | null;
  createdAt: Date;
};

export default async function AuditPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ kind?: string; status?: string; rating?: string }>;
}) {
  const { locale } = await props.params;
  const search = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return (
      <>
        <TitleBar title="Logs" description="Every run, approval, and rating — scoped to this tenant." />
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">Sign in to view the logs.</div>
      </>
    );
  }

  const kindFilter = search.kind === 'skill' || search.kind === 'workflow' ? search.kind : undefined;
  const statusFilter = search.status || undefined;
  const ratingFilter = search.rating === 'up' || search.rating === 'down' ? search.rating : undefined;

  const skillRuns = kindFilter === 'workflow'
    ? []
    : await db
        .select({
          id: skillRunSchema.id,
          status: skillRunSchema.status,
          rating: skillRunSchema.rating,
          contextSha: skillRunSchema.contextSha,
          createdBy: skillRunSchema.createdBy,
          createdAt: skillRunSchema.createdAt,
          slug: skillSchema.slug,
          name: skillSchema.name,
        })
        .from(skillRunSchema)
        .leftJoin(skillSchema, eq(skillRunSchema.skillId, skillSchema.id))
        .where(and(
          eq(skillRunSchema.orgId, orgId),
          statusFilter ? eq(skillRunSchema.status, statusFilter) : undefined,
          ratingFilter ? eq(skillRunSchema.rating, ratingFilter) : undefined,
        ))
        .orderBy(desc(skillRunSchema.createdAt))
        .limit(100);

  const workflowRuns = kindFilter === 'skill'
    ? []
    : await db
        .select({
          id: workflowRunSchema.id,
          status: workflowRunSchema.status,
          rating: workflowRunSchema.rating,
          contextSha: workflowRunSchema.contextSha,
          createdBy: workflowRunSchema.createdBy,
          createdAt: workflowRunSchema.createdAt,
          slug: workflowSchema.slug,
          name: workflowSchema.name,
        })
        .from(workflowRunSchema)
        .leftJoin(workflowSchema, eq(workflowRunSchema.workflowId, workflowSchema.id))
        .where(and(
          eq(workflowRunSchema.orgId, orgId),
          statusFilter ? eq(workflowRunSchema.status, statusFilter) : undefined,
          ratingFilter ? eq(workflowRunSchema.rating, ratingFilter) : undefined,
        ))
        .orderBy(desc(workflowRunSchema.createdAt))
        .limit(100);

  const rows: Row[] = [
    ...skillRuns.map(r => ({
      kind: 'skill' as const,
      id: r.id,
      slug: r.slug ?? '—',
      name: r.name,
      status: r.status,
      rating: r.rating as 'up' | 'down' | null,
      contextSha: r.contextSha,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
    ...workflowRuns.map(r => ({
      kind: 'workflow' as const,
      id: r.id,
      slug: r.slug ?? '—',
      name: r.name,
      status: r.status,
      rating: r.rating as 'up' | 'down' | null,
      contextSha: r.contextSha,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);

  const upCount = rows.filter(r => r.rating === 'up').length;
  const downCount = rows.filter(r => r.rating === 'down').length;
  const approvedCount = rows.filter(r => r.status === 'approved').length;

  return (
    <>
      <TitleBar
        title="Logs"
        description="Every run, approval, and rating — scoped to this tenant. Each row traces to the exact context SHA that produced it."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total runs" value={rows.length} />
        <Stat label="Approved" value={approvedCount} />
        <Stat label="👍" value={upCount} />
        <Stat label="👎" value={downCount} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Filter:</span>
        <FilterPill href="/dashboard/logs" active={!kindFilter && !statusFilter && !ratingFilter}>All</FilterPill>
        <FilterPill href="/dashboard/logs?kind=skill" active={kindFilter === 'skill'}>Skills</FilterPill>
        <FilterPill href="/dashboard/logs?kind=workflow" active={kindFilter === 'workflow'}>Workflows</FilterPill>
        <span className="mx-1 text-muted-foreground/40">·</span>
        <FilterPill href="/dashboard/logs?status=approved" active={statusFilter === 'approved'}>Approved</FilterPill>
        <FilterPill href="/dashboard/logs?status=rejected" active={statusFilter === 'rejected'}>Rejected</FilterPill>
        <FilterPill href="/dashboard/logs?status=pending" active={statusFilter === 'pending'}>Pending</FilterPill>
        <FilterPill href="/dashboard/logs?status=completed" active={statusFilter === 'completed'}>Completed</FilterPill>
        <FilterPill href="/dashboard/logs?status=failed" active={statusFilter === 'failed'}>Failed</FilterPill>
        <span className="mx-1 text-muted-foreground/40">·</span>
        <FilterPill href="/dashboard/logs?rating=up" active={ratingFilter === 'up'}>👍</FilterPill>
        <FilterPill href="/dashboard/logs?rating=down" active={ratingFilter === 'down'}>👎</FilterPill>
      </div>

      {rows.length === 0
        ? (
            <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No runs matching this filter.
            </div>
          )
        : (
            <div className="overflow-hidden rounded-lg border border-border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">When</th>
                    <th className="px-3 py-2 text-left font-medium">Kind</th>
                    <th className="px-3 py-2 text-left font-medium">Slug</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Rating</th>
                    <th className="px-3 py-2 text-left font-medium">Context</th>
                    <th className="px-3 py-2 text-left font-medium">By</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={`${r.kind}-${r.id}`} className="border-t border-border/50 text-xs">
                      <td className="px-3 py-2 whitespace-nowrap">{r.createdAt.toLocaleString()}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="font-mono">{r.kind}</Badge>
                      </td>
                      <td className="px-3 py-2 font-mono">{r.slug}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-2">
                        <FeedbackButtons runId={r.id} kind={r.kind} initialRating={r.rating} compact />
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">
                        {r.contextSha ? r.contextSha.slice(0, 7) : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.createdBy ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Link href={`/dashboard/${r.kind === 'skill' ? 'skills' : 'workflows'}/${r.slug}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                          <ExternalLink className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border p-3 text-center">
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function FilterPill({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-2.5 py-1 font-medium transition ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </Link>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (!isRunStatus(status)) {
    // Unknown status — render the raw string so we don't silently drop signal.
    return <span className="text-xs text-muted-foreground">{status}</span>;
  }
  return <StatusPill status={status} size="sm" />;
}
