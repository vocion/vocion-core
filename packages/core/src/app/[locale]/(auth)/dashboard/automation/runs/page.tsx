import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { AutomationRunLog } from '@/features/dashboard/AutomationRunLog';
import { RunLogFilters } from '@/features/dashboard/RunLogFilters';
import { parseRunLogQuery } from '@/features/dashboard/runLogQuery';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { automationRunFacets, listAutomationRuns } from '@/services/AutomationService';

/**
 * The run log — every fire across every automation, newest first.
 *
 * The surface that answers "has this been running" for the whole system at
 * once, which is exactly what nobody could answer for 3 September: three
 * hourly automations stopped for nineteen hours and the only trace was a table
 * `psql` reached. Filters live in the URL, so a filtered log is a link.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function AutomationRunsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const query = parseRunLogQuery(await props.searchParams);
  const [{ runs, total, nextCursor }, facets] = await Promise.all([
    listAutomationRuns(orgId, query),
    automationRunFacets(orgId),
  ]);

  return (
    <>
      <TitleBar
        title="Run log"
        description="Every automation fire, newest first. Started, duration, what invoked it, what it found, and the run carrying the report."
      />

      <div className="mb-4">
        <Link href="/dashboard/automation" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Automations
        </Link>
      </div>

      <RunLogFilters facets={facets} basePath="/dashboard/automation/runs" />

      <p className="mb-3 text-xs text-muted-foreground">
        {total}
        {' '}
        fire
        {total === 1 ? '' : 's'}
        {' '}
        match these filters
        {runs.length < total ? `, showing ${runs.length}` : ''}
        .
      </p>

      <AutomationRunLog runs={runs} />

      {nextCursor !== null && (
        <div className="mt-3">
          <Link
            href={`/dashboard/automation/runs?${new URLSearchParams({ ...toQuery(query), cursor: String(nextCursor) }).toString()}`}
            className="inline-flex items-center rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            Older fires →
          </Link>
        </div>
      )}
    </>
  );
}

/**
 * The active filters as query params, so paging keeps them.
 * @param query
 */
function toQuery(query: ReturnType<typeof parseRunLogQuery>): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.slug) {
    out.slug = query.slug;
  }
  if (query.status) {
    out.status = query.status;
  }
  if (query.kind) {
    out.kind = query.kind;
  }
  if (query.invokedBy) {
    out.invokedBy = query.invokedBy;
  }
  if (query.since) {
    out.since = query.since.toISOString().slice(0, 10);
  }
  return out;
}
