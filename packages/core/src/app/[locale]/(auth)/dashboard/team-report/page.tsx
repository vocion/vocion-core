import type { ReportWindow, TeamReport, TeamReportTeam } from '@/services/TeamReportService';
import { setRequestLocale } from 'next-intl/server';
import { AdvancedMenu } from '@/features/dashboard/team-report/AdvancedMenu';
import { DimensionStrip } from '@/features/dashboard/team-report/DimensionStrip';
import { EvidenceDisclosure } from '@/features/dashboard/team-report/EvidenceDisclosure';
import { HeadlineRow } from '@/features/dashboard/team-report/HeadlineRow';
import { MemberTable } from '@/features/dashboard/team-report/MemberTable';
import { PrimaryOutcome } from '@/features/dashboard/team-report/PrimaryOutcome';
import { ControlLine, NeedsYou, Roster } from '@/features/dashboard/team-report/TeamFacts';
import { WorkforceSetup } from '@/features/dashboard/team-report/WorkforceSetup';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { parseReportWindow, REPORT_WINDOWS, teamReport } from '@/services/TeamReportService';
import { ORG_ROLE } from '@/types/Auth';

/**
 * /dashboard/team-report — Team performance.
 *
 * Built to docs/specs/team-report-v2.md. A revenue leader should be able to
 * answer in ten seconds: what are my AI teams supposed to accomplish, are
 * they accomplishing it, what is it costing, how much human help do they
 * need, where is something going wrong.
 *
 * Two states. SETUP — no workspace outcome, no measured team, or no work
 * ever — is a four-line checklist with one primary action, and the teams
 * as a light roster. The REPORT leads with the workspace goal and a
 * headline row, then per team: mission → primary outcome, big, with
 * provenance → Quality · Velocity · Economics · Human load → roster →
 * control → needs you → evidence (collapsed). Tokens and every file path
 * live under Evidence and Advanced respectively.
 */

export const dynamic = 'force-dynamic';

export default async function TeamReportPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const { locale } = await props.params;
  const { window: rawWindow } = await props.searchParams;
  setRequestLocale(locale);
  const { orgId, has } = await auth();
  const window = parseReportWindow(rawWindow);

  if (!orgId) {
    return <TitleBar title="Team performance" description="Sign in to an organization to see how its AI workforce is performing." />;
  }

  const report = await teamReport(orgId, window);
  const isAdmin = Boolean(has?.({ role: ORG_ROLE.ADMIN }));
  return <TeamReportScreen report={report} isAdmin={isAdmin} />;
}

/**
 * Sync body: the async page only loads.
 * @param root0
 * @param root0.report - The assembled report.
 * @param root0.isAdmin - Whether the viewer may apply configuration.
 */
function TeamReportScreen({ report, isAdmin }: { report: TeamReport; isAdmin: boolean }) {
  const { window } = report;
  const now = report.range.until;
  const advanced = <AdvancedMenu teams={report.teams.map(t => ({ slug: t.slug, name: t.name }))} />;

  if (report.setup.needed) {
    return (
      <>
        <TitleBar
          title="Team performance"
          description={(
            <>
              <span className="font-medium text-foreground">{report.workspace.name}</span>
              {report.goal
                ? (
                    <>
                      {' '}
                      —
                      <em>{report.goal}</em>
                    </>
                  )
                : <> — workforce setup</>}
            </>
          )}
          actions={advanced}
        />
        <WorkforceSetup report={report} isAdmin={isAdmin} />
      </>
    );
  }

  return (
    <>
      <TitleBar
        title="Team performance"
        description={(
          <>
            <span className="font-medium text-foreground">{report.workspace.name}</span>
            {report.goal && (
              <>
                {' — '}
                <em>{report.goal}</em>
              </>
            )}
          </>
        )}
        actions={(
          <>
            <WindowChips active={window} />
            {advanced}
          </>
        )}
      />

      <HeadlineRow report={report} now={now} />

      {report.teams.map(team => <TeamSection key={team.slug} team={team} window={window} now={now} />)}

      {report.ungrouped.length > 0 && (
        <section id="unassigned" className="border-b border-border py-6">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Unassigned agents</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {report.ungrouped.length}
              {report.ungrouped.length === 1 ? ' agent' : ' agents'}
              {' · '}
              {Math.round(report.ungrouped.reduce((a, m) => a + m.shareOfCents, 0) * 100)}
              % of operating cost
            </span>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            These agents are on no team, so their cost has no outcome to weigh against. Assign each to a team from the
            {' '}
            <Link href="/dashboard/teams" className="text-primary hover:underline">org chart</Link>
            .
          </p>
          <MemberTable members={report.ungrouped} window={window} />
        </section>
      )}
    </>
  );
}

/**
 * One team, in the spec's order: name + mission → primary outcome, big →
 * the four dimensions → roster · control · needs you → evidence, collapsed.
 * @param root0
 * @param root0.team
 * @param root0.window
 * @param root0.now
 */
function TeamSection({ team, window, now }: { team: TeamReportTeam; window: ReportWindow; now: Date }) {
  return (
    <section id={`team-${team.slug}`} className="scroll-mt-20 border-b border-border py-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          <Link href={`/dashboard/teams/${team.slug}`} className="hover:text-primary">{team.name}</Link>
        </h2>
        {team.contract.measures.length > 1 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {team.contract.measures.filter(m => m.met).length}
            {' of '}
            {team.contract.measures.length}
            {' measures on target'}
          </span>
        )}
      </div>
      {team.mission
        ? <p className="mt-0.5 max-w-3xl text-sm font-medium text-foreground/85">{team.mission}</p>
        : <p className="mt-0.5 text-sm text-muted-foreground">No mission stated yet.</p>}

      <div className="mt-5">
        {team.primary
          ? <PrimaryOutcome teamSlug={team.slug} reading={team.primary} now={now} />
          : (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground/80">Performance isn't configured yet.</span>
                {' '}
                Add a measure and a target for this team — the workspace setup form does it in one step.
              </p>
            )}
      </div>

      <div className="mt-5">
        <DimensionStrip team={team} now={now} />
      </div>

      <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-border pt-4 lg:grid-cols-3">
        <Roster team={team} />
        <ControlLine team={team} />
        <NeedsYou team={team} now={now} />
      </dl>

      <EvidenceDisclosure team={team} window={window} now={now} />
    </section>
  );
}

/**
 * Window chips — links, so the page stays a server component and the URL
 * carries the state. The chips set the ACTIVITY window (cost, human load,
 * evidence); each measure reads its own authored window regardless.
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
          {w}
        </Link>
      ))}
    </div>
  );
}
