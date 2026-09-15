import type { ReportWindow, TeamReport, TeamReportTeam } from '@/services/TeamReportService';
import { ArrowUpRight, ChevronRight, Gauge } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { EmptyState } from '@/components/ui/empty-state';
import { ContractGrid } from '@/features/dashboard/team-report/ContractGrid';
import { ago, compact, pct, usd, windowLabel } from '@/features/dashboard/team-report/format';
import { KpiMeter } from '@/features/dashboard/team-report/KpiMeter';
import { MemberTable } from '@/features/dashboard/team-report/MemberTable';
import { assignSwatches, OTHER } from '@/features/dashboard/team-report/palette';
import { KindMix } from '@/features/dashboard/team-report/RunKindBadge';
import { WeightStrip } from '@/features/dashboard/team-report/WeightStrip';
import { OwnerChip } from '@/features/dashboard/teams/OwnerChip';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { parseReportWindow, REPORT_WINDOWS, teamReport } from '@/services/TeamReportService';

/**
 * /dashboard/team-report — the outcome contract, team by team, with the
 * activity beneath it.
 *
 * Shaped by the Product Design Manifesto (`docs/MANIFESTO.md`): outcomes
 * over activity, hide complexity but never truth, one obvious next action.
 * The page leads with the workspace's contract (purpose, owner, current
 * performance, permission posture) and its spend; each team section leads
 * with ITS contract — purpose, owner, KPIs from baseline to target, autonomy,
 * permissions, escalation — then states spend weight beside outcome
 * attainment. Runs, tokens and per-member spend are the evidence layer, in a
 * disclosure that is closed by default. Board reviews and red-team grades are
 * labelled as judgement/quality spend, never as output.
 * Source of truth: `worker_run` (ADR 0004) via `TeamReportService`.
 */

export const dynamic = 'force-dynamic';

const INBOX = '/dashboard/inbox';

export default async function TeamReportPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { locale } = await props.params;
  const { window: rawWindow } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const window = parseReportWindow(rawWindow);

  if (!orgId) {
    return <TitleBar title="Team report" description="Sign in to an organization to see its team report." />;
  }

  const report = await teamReport(orgId, window);
  return <TeamReportScreen report={report} />;
}

/**
 * Sync body: the async page only loads.
 * @param root0
 * @param root0.report - The assembled report.
 */
function TeamReportScreen({ report }: { report: TeamReport }) {
  const { window, totals } = report;
  const teamSwatches = assignSwatches(report.teams.map(t => t.slug));
  const allMembers = [...report.teams.flatMap(t => t.members), ...report.ungrouped];
  const memberSwatches = assignSwatches(allMembers.map(m => m.slug));
  const measuredTeams = report.teams.filter(t => t.contract.kpis.length > 0);

  return (
    <>
      <TitleBar
        title="Team report"
        description="Each team's outcome contract — purpose, owner, measurement, autonomy — with spend weighed against outcome. The activity underneath is evidence."
        actions={<WindowChips active={window} />}
      />

      {/* ── The workspace's contract ─────────────────────────────────────── */}
      <section className="border-b border-border pb-6">
        <dl className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Purpose</dt>
            <dd className="mt-0.5">
              {report.goal
                ? <p className="text-lg leading-snug font-medium">{report.goal}</p>
                : (
                    <p className="text-sm text-muted-foreground">
                      No workspace goal stated yet — add
                      {' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">goal:</code>
                      {' '}
                      to
                      {' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">workspace.yaml</code>
                      .
                    </p>
                  )}
            </dd>
            <dt className="mt-3 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Owner</dt>
            <dd className="mt-0.5"><OwnerChip accountable={report.owner} /></dd>
          </div>
          <Stat
            label="Current performance"
            value={report.attainment === null ? '—' : pct(report.attainment)}
            note={report.attainment === null
              ? 'No team measures anything yet'
              : `${measuredTeams.filter(t => t.contract.kpis.every(k => k.met)).length} of ${measuredTeams.length} measured teams on target`}
          />
          <Stat
            label={`Spend · ${windowLabel(window).toLowerCase()}`}
            value={usd(totals.cents)}
            note={totals.judgementCents > 0 ? `${pct(totals.judgementCents / totals.cents)} on judgement (board, red team)` : `${compact(totals.tokens)} tokens`}
          />
          <Stat
            label="Permissions"
            value={report.autoExecuteActions === 0 ? 'Human-gated' : `${report.autoExecuteActions} auto`}
            note={report.autoExecuteActions === 0 ? 'No action auto-executes; every outward step waits for a person' : 'actions may auto-execute under trust rules'}
          />
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            {totals.runs}
            {' '}
            runs
            {totals.active > 0 ? ` · ${totals.active} running` : ''}
            {totals.failed > 0 ? ` · ${totals.failed} failed` : ''}
            {' · last activity '}
            {ago(totals.lastActivity)}
          </span>
          <Link href={INBOX} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            What needs a person
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </section>

      {totals.runs === 0 && report.teams.length === 0
        ? (
            <div className="mt-8">
              <EmptyState
                icon={Gauge}
                title="No teams and no runs yet"
                description="Author teams/<slug>.yaml with a goal and kpis, and point a worker at /api/v1/worker-runs — the contract and its evidence appear here."
              />
            </div>
          )
        : (
            <>
              {report.teams.map(team => <TeamSection key={team.slug} team={team} window={window} />)}

              {report.ungrouped.length > 0 && (
                <section id="ungrouped" className="border-b border-border py-6">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-base font-semibold">Not on a team</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {pct(report.ungrouped.reduce((a, m) => a + m.shareOfCents, 0))}
                      {' of spend · '}
                      {report.ungrouped.length}
                      {report.ungrouped.length === 1 ? ' agent' : ' agents'}
                    </span>
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    These agents carry no team contract, so their spend has no outcome to weigh against. Give each a
                    {' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">team:</code>
                    {' '}
                    or make the workspace lead a team of one.
                  </p>
                  <MemberTable members={report.ungrouped} window={window} />
                </section>
              )}

              {/* ── Evidence across the org: where the spend went ───────────── */}
              {totals.runs > 0 && (
                <details className="group border-b border-border py-5">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold marker:content-none">
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                    Where the spend went
                    <span className="font-normal text-muted-foreground">
                      {' · '}
                      {usd(totals.cents)}
                      {' across '}
                      {totals.runs}
                      {' runs'}
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-6 lg:grid-cols-2">
                    <div>
                      <h3 className="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">By team</h3>
                      <WeightStrip
                        ariaLabel="Share of spend by team"
                        total={totals.cents}
                        segments={[
                          ...report.teams.map(t => ({ key: t.slug, label: t.name, value: t.cents, swatch: teamSwatches.get(t.slug)!, href: `#team-${t.slug}` })),
                          ...(report.ungrouped.length > 0 ? [{ key: '__ungrouped', label: 'Not on a team', value: report.ungrouped.reduce((a, m) => a + m.cents, 0), swatch: OTHER, href: '#ungrouped' }] : []),
                        ]}
                      />
                    </div>
                    <div>
                      <h3 className="mb-3 text-xs font-medium tracking-wider text-muted-foreground uppercase">By member</h3>
                      <WeightStrip
                        ariaLabel="Share of spend by member"
                        total={totals.cents}
                        segments={[...allMembers].sort((a, b) => b.cents - a.cents).map(m => ({ key: m.slug, label: m.name, value: m.cents, swatch: memberSwatches.get(m.slug)!, href: `/dashboard/team-report/${encodeURIComponent(m.slug)}?window=${window}` }))}
                      />
                    </div>
                  </div>
                  {totals.judgementCents > 0 && (
                    <p className="mt-4 text-xs text-muted-foreground">
                      {usd(totals.judgementCents)}
                      {' of this is judgement — board reviews and red-team grades. It buys quality, not output, and is counted separately above.'}
                    </p>
                  )}
                </details>
              )}
            </>
          )}
    </>
  );
}

/**
 * One team: the contract first, then weight against outcome, then the
 * evidence in a closed disclosure.
 * @param root0
 * @param root0.team
 * @param root0.window
 */
function TeamSection({ team, window }: { team: TeamReportTeam; window: ReportWindow }) {
  const { contract } = team;
  return (
    <section id={`team-${team.slug}`} className="scroll-mt-20 border-b border-border py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">
          <Link href={`/dashboard/teams/${team.slug}`} className="hover:text-primary">{team.name}</Link>
        </h2>
        {/* Weight against outcome — the one comparison this page exists for. */}
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{pct(team.shareOfCents)}</span>
          <span className="text-muted-foreground"> of spend</span>
          <span className="mx-2 text-muted-foreground/60">·</span>
          {contract.attainment === null
            ? <span className="text-muted-foreground">outcome not measured</span>
            : (
                <>
                  <span className="font-semibold">{pct(contract.attainment)}</span>
                  <span className="text-muted-foreground"> of target</span>
                </>
              )}
        </p>
      </div>

      <div className="mt-4">
        <ContractGrid
          contract={contract}
          escalationHref={`${INBOX}?team=${encodeURIComponent(team.slug)}`}
          purposeFallback={`No goal authored — add goal: to teams/${team.slug}.yaml.`}
        />
      </div>

      {contract.kpis.length > 0
        ? (
            <div className="mt-5">
              <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Measurement</div>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                {contract.kpis.map(k => <KpiMeter key={k.key} kpi={k} />)}
              </div>
            </div>
          )
        : (
            <p className="mt-4 text-xs text-muted-foreground">
              Nothing measured yet — add
              {' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">kpis:</code>
              {' '}
              (key, target, and a
              {' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">counts.&lt;key&gt;</code>
              {' '}
              the workers report) to
              {' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                teams/
                {team.slug}
                .yaml
              </code>
              .
            </p>
          )}

      {/* ── Evidence: closed by default; the truth is one click away. ───── */}
      <details className="group mt-5">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-medium marker:content-none">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          Evidence
          <span className="font-normal text-muted-foreground tabular-nums">
            {' · '}
            {team.runs}
            {' runs · '}
            {usd(team.cents)}
            {' · '}
            {compact(team.tokens)}
            {' tokens · last '}
            {ago(team.lastActivity)}
          </span>
          <span className="ml-1"><KindMix byKind={team.byKind} /></span>
        </summary>
        <div className="mt-3">
          {team.judgementCents > 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              {usd(team.judgementCents)}
              {' of this team’s spend is judgement (board, red team) — quality, not output.'}
            </p>
          )}
          <MemberTable members={team.members} window={window} />
        </div>
      </details>
    </section>
  );
}

/**
 * Window chips — links, so the page stays a server component and the URL
 * carries the state.
 * @param root0
 * @param root0.active
 */
function WindowChips({ active }: { active: ReportWindow }) {
  return (
    <div className="flex gap-1" role="tablist" aria-label="Report window">
      {REPORT_WINDOWS.map(w => (
        <Link
          key={w}
          href={`/dashboard/team-report?window=${w}`}
          role="tab"
          aria-selected={w === active}
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${w === active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
        >
          {w === 'all' ? 'All time' : w}
        </Link>
      ))}
    </div>
  );
}

/**
 * A stat tile: label over value, optional note.
 * @param root0
 * @param root0.label
 * @param root0.value
 * @param root0.note
 */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className="text-2xl leading-tight font-semibold">{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}
