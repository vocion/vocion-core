import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AutomationCardStatus } from '@/features/dashboard/AutomationCardStatus';
import { AutomationFireStrip } from '@/features/dashboard/AutomationFireStrip';
import { checkResultOf } from '@/features/dashboard/automationResult';
import { AutomationRunLog } from '@/features/dashboard/AutomationRunLog';
import { AutomationTestRun } from '@/features/dashboard/AutomationTestRun';
import { RunLogFilters } from '@/features/dashboard/RunLogFilters';
import { parseRunLogQuery } from '@/features/dashboard/runLogQuery';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { cronToText } from '@/features/dashboard/TriggerBadge';
import { clerkAuth as auth } from '@/libs/Auth';
import { cronIntervalMs } from '@/libs/cron/schedule';
import { Link } from '@/libs/I18nNavigation';
import {
  automationRunFacets,
  automationSourceFreshness,
  describeAutomationSchedule,
  getAutomation,
  listAutomationRuns,
  scheduleHealth,
} from '@/services/AutomationService';

/** Two weeks of hourly fires is what makes "healthy for twelve days" visible as such. */
const STRIP_DAYS = 13;

/**
 * Now, read once per render. `Date.now()` counts as impure inside a render, so
 * the clock is taken here and threaded through — which also keeps the strip,
 * the health verdict and the log window agreeing on one instant.
 */
async function currentTime(): Promise<Date> {
  return new Date();
}

/**
 * One automation: its definition, its fire history as an hourly strip, and the
 * run log filtered to it.
 *
 * The strip is the picture that had to be built by hand from `psql` to find the
 * 3 September outage. Drawn here, twelve days of hourly green is one glance and
 * the nineteen-hour gap is one glance too.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function AutomationDetailPage(props: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, slug } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const automation = await getAutomation(orgId, slug);
  if (!automation) {
    notFound();
  }

  const cron = automation.whenConfig.schedule ?? null;
  const now = await currentTime();
  const query = parseRunLogQuery(await props.searchParams, { slug, limit: 200 });
  const [{ runs, total }, facets, live, strip] = await Promise.all([
    listAutomationRuns(orgId, query),
    automationRunFacets(orgId),
    cron ? describeAutomationSchedule(orgId, slug) : Promise.resolve(null),
    // The strip is drawn from an UNFILTERED window: a status filter on the log
    // must not silently remove hours from the history above it.
    listAutomationRuns(orgId, {
      slug,
      since: new Date(now.getTime() - STRIP_DAYS * 24 * 3_600_000),
      limit: 500,
    }),
  ]);
  // Newest by START time, not by row id: a later-inserted row can be an older
  // fire, and the stuck 4 September row would otherwise read as "last run".
  const lastRun = strip.runs.reduce<typeof strip.runs[number] | null>(
    (newest, run) => (newest === null || run.startedAt > newest.startedAt ? run : newest),
    null,
  );
  const freshness = await automationSourceFreshness(orgId, checkResultOf(lastRun?.result)?.mirror?.sources ?? []);
  const health = scheduleHealth({ cron, lastFireAt: lastRun?.startedAt ?? null, paused: live?.paused, now });
  const interval = cron ? cronIntervalMs(cron, now) : null;
  const firesEveryHour = interval !== null && interval <= 3_600_000;

  return (
    <>
      <TitleBar
        title={automation.name}
        description={automation.description ?? 'Fire history and the run log for this automation.'}
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <Link href="/dashboard/automation" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Automations
        </Link>
        <Link href="/dashboard/automation/runs" className="text-xs text-muted-foreground hover:text-foreground">
          All automations’ fires →
        </Link>
      </div>

      <div className="mb-6 grid gap-4 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            <span className="font-medium text-foreground">When:</span>
            {' '}
            {cron
              ? <span title={cron}>{cronToText(cron)}</span>
              : (
                  <code className="font-mono">
                    on
                    {automation.whenConfig.event}
                  </code>
                )}
          </div>
          <div>
            <span className="font-medium text-foreground">Does:</span>
            {' '}
            {automation.doConfig.checkMission
              ? `check mission ${automation.doConfig.checkMission}`
              : automation.doConfig.workflow
                ? `run workflow ${automation.doConfig.workflow}`
                : automation.doConfig.job
                  ? `run job ${automation.doConfig.job}`
                  : 'nothing configured'}
          </div>
          <div className="pt-2">
            <AutomationTestRun
              slug={slug}
              kind={automation.doConfig.checkMission ? 'mission_check' : automation.doConfig.workflow ? 'workflow' : 'job'}
              supportsDay={false}
            />
          </div>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <AutomationCardStatus run={lastRun} health={health} freshness={freshness} slug={slug} />
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">
          Fire history —
          {' '}
          {STRIP_DAYS}
          {' '}
          days
        </h2>
        {/* Empty hours only read as GAPS for a schedule that expects a fire in
            every hour. On a daily cron most hours are empty by design, so
            drawing them as gaps would cry outage 23 times a day. */}
        <AutomationFireStrip runs={strip.runs} days={STRIP_DAYS} expected={firesEveryHour} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Fires</h2>
        <RunLogFilters facets={facets} basePath={`/dashboard/automation/${slug}`} pinnedSlug={slug} />
        <p className="mb-3 text-xs text-muted-foreground">
          {total}
          {' '}
          fire
          {total === 1 ? '' : 's'}
          {' '}
          match these filters
          {runs.length < total ? `, showing the newest ${runs.length}` : ''}
          .
        </p>
        <AutomationRunLog runs={runs} showAutomation={false} />
      </section>
    </>
  );
}
