import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { FeatureReportView, ReportContextLine, reportLiveRefresh } from '@/features/dashboard/factory/FeatureReportView';
import { RecordChangeIntent } from '@/features/dashboard/objects/RecordChangeIntent';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { VersionChip } from '@/features/dashboard/versions/VersionChip';
import { VersionWatch } from '@/features/dashboard/versions/VersionWatch';
import { WikiView } from '@/features/dashboard/wiki/WikiView';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { featureStatusOf } from '@/services/factory/featureReport';
import { loadFeatureReport } from '@/services/factory/featureReportData';
import { recordVersionOf } from '@/services/objects/recordBody';
import { recordHref } from '@/services/objects/recordHref';
import { relatedOf, relatedWrites } from '@/services/objects/related';
import { readPageForOrg } from '@/services/PluginService';

/**
 * The `report` archetype's route — `/dashboard/p/<slug>/<id>`.
 *
 * One record's whole story on one page: the ask, triage, the contract,
 * approvals, the runs, the change, QA evidence, the release, and a money
 * line of estimate against actual. The plugin declares the page
 * (`archetype: report`, `report.subject: request`); the assembly is
 * `services/factory/featureReport.ts` and the drawing is
 * `features/dashboard/factory/FeatureReportView.tsx`.
 *
 * Sibling of `../page.tsx` rather than a branch inside it: a report takes a
 * record id in the path, and every other archetype does not.
 * @param props - Next's route props.
 * @param props.params - `{locale, slug, id}` — the page slug and the record.
 */
export default async function WorkspaceReportPage(props: {
  params: Promise<{ locale: string; slug: string; id: string }>;
}) {
  const { locale, slug, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    redirect('/api/auth/signout?callbackUrl=/sign-in');
  }

  const manifest = await readPageForOrg(slug, orgId);
  // A wiki page by slug: the same rail, this page open.
  if (manifest?.archetype === 'wiki' && manifest.source?.kind === 'artifacts' && manifest.source.folder) {
    const { loadWikiReadingPages } = await import('@/services/wiki/wikiReading');
    const { wikiSlug } = await import('@/services/wiki/WikiService');
    const pageSlug = wikiSlug(id);
    const pages = await loadWikiReadingPages(orgId, manifest.source.folder, { withBodyFor: pageSlug });
    const current = pages.find(p => p.slug === pageSlug) ?? null;
    if (!current) {
      return notFound();
    }
    const guide = await readPageForOrg(`${manifest.slug}-guide`, orgId);
    return (
      <>
        <TitleBar title={manifest.title} description={manifest.description} />
        <WikiView
          base={`/dashboard/p/${manifest.slug}`}
          pages={pages}
          current={current}
          guideHref={guide ? `/dashboard/p/${guide.slug}` : null}
          askAgentSlug="wiki-researcher"
          editBase="/dashboard/artifacts"
        />
      </>
    );
  }
  // A run's own page (the Runs log's row link), read like a runner page: its
  // steps, each opening onto its log, live while the run is (backlog 036).
  // `agent-<id>` is an agent run (mission_run) in the same log.
  if (manifest?.source?.kind === 'workerRuns') {
    const { readRunLog } = await import('@/services/runs/RunLogService');
    const { RunDetail } = await import('@/features/dashboard/factory/RunDetail');
    const data = await readRunLog(orgId, id);
    if (!data) {
      return notFound();
    }
    // No list header above it: the run is the page's title (red team,
    // 2026-09-28 — "Runs / Every run…" over the run read as two titles).
    return <RunDetail initial={data} />;
  }
  // A product's OVERVIEW — what a Products card's name opens. Keyed on the
  // page's derivation rather than its slug: a page that derives a product
  // board is the products page, whatever a workspace called it.
  if (manifest?.derive === 'productBoard') {
    const { loadProductOverview } = await import('@/services/factory/productOverviewData');
    const { ProductOverviewView } = await import('@/features/dashboard/factory/ProductOverviewView');
    const now = new Date();
    const overview = await loadProductOverview(orgId, id, now);
    const related = overview ? await relatedOf(orgId, Number(id)).catch(() => []) : [];
    const writes = overview ? await relatedWrites(orgId, Number(id)).catch(() => []) : [];
    return overview
      ? <ProductOverviewView overview={overview} page={{ slug: manifest.slug, title: manifest.title }} now={now.getTime()} related={related} writes={writes} />
      : notFound();
  }
  // A release's own page (the Releases feed's row link): what changed for
  // people, whether it verified, and who hears about it — not the generic
  // object page, which read "Back to Objects" over a sha.
  if (manifest?.recordPage?.kind === 'release') {
    const releaseId = Number(id);
    if (!Number.isInteger(releaseId) || releaseId <= 0) {
      return notFound();
    }
    const { loadReleaseArtifacts, loadReleaseLinked, loadReleaseRow } = await import('@/services/factory/releaseData');
    const row = await loadReleaseRow(orgId, releaseId);
    if (!row) {
      return notFound();
    }
    const { assembleReleaseReport } = await import('@/services/factory/releaseReport');
    const { ReleaseDetailView } = await import('@/features/dashboard/factory/ReleaseDetailView');
    const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
    const { evidenceArtifactIdsOf } = await import('@/libs/workspace/criterionEvidence');
    const ids = evidenceArtifactIdsOf(row.meta);
    const [linked, artifacts, timeZone] = await Promise.all([loadReleaseLinked(orgId, [row]), loadReleaseArtifacts(orgId, ids), workspaceTimeZone(orgId)]);
    const report = assembleReleaseReport(row, { linked, artifacts, timeZone, now: new Date() });
    const related = await relatedOf(orgId, releaseId).catch(() => []);
    return <ReleaseDetailView report={report} recordPage={manifest.recordPage} backHref={`/dashboard/p/${manifest.slug}`} related={related} />;
  }
  if (!manifest || manifest.archetype !== 'report' || !manifest.report) {
    return notFound();
  }

  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return notFound();
  }

  const now = new Date();
  const report = await loadFeatureReport(orgId, recordId, now);
  // The three lines, with the record's own page as their base — the same
  // read the API, the pane and the chat draw (`services/objects/recordStatus.ts`).
  const status = report
    ? featureStatusOf(report, { objectType: manifest.report.subject, href: await recordHref(orgId, { objectType: manifest.report.subject, id: recordId }) }, now)
    : undefined;
  // The record's version closes the metadata line, and carries the page's
  // re-read while anything runs (one chip, not a History row and a live row).
  const version = report ? await recordVersionOf(orgId, report.requestId).catch(() => null) : null;
  const chip = report
    ? <VersionChip objectId={report.requestId} version={version?.version ?? null} updatedAt={version?.at ?? null} live={reportLiveRefresh(report)} />
    : null;
  // What it is connected to, in the one Related block (`relatedOf`).
  const related = report ? await relatedOf(orgId, report.requestId).catch(() => []) : [];

  return (
    <>
      {/* The WORK's own name and goal.
          It read "Request 40 — One request end to end: the ask, triage, the
          plan and who approved it, the contract, approvals, the runs, the
          change, QA evidence, the release, and what it cost against the
          estimate." That is documentation of the database, printed above every
          piece of work, identical on all of them. Chris, 2026-09-22: *"That's
          internal documentation explaining your database."* The subtitle is
          now what this work is FOR, and falls back to nothing rather than to
          boilerplate — a page with no goal recorded should look like one. */}
      {/* The goal, then which work this is — product, size, spend, age. Both
          belong in the title block: a person reading the outcome needs to know
          which product it is on before anything below the fold means anything,
          and the breadcrumb ("Factory / 121") tells them neither. */}
      <TitleBar
        title={report ? report.title : manifest.title}
        description={report
          ? (
              // The subtitle reads at body size and normal contrast — it is
              // what the work is FOR; the context line under it is metadata,
              // smaller and muted (Chris, 2026-09-28), closed by the version.
              <>
                {report.goal && <span className="block text-[15px] leading-relaxed text-foreground">{report.goal}</span>}
                <ReportContextLine bits={report.context} end={chip} />
              </>
            )
          : manifest.description}
      />
      {/* The workforce panel does NOT belong here. "5 measures · 4 agents · 14
          skills" is configuration for the whole factory, shown above one piece
          of work: "I clicked into one specific piece of work. Don't show me
          workforce configuration." It lives on the plugin's own pages. */}
      {report && <RecordChangeIntent objectId={report.requestId} title={report.title} selectionRoot={'[id^="report-"]'} />}
      {report && <VersionWatch refs={[{ type: 'object', id: String(report.requestId) }]} />}
      {report
        ? <FeatureReportView report={report} status={status} related={related} />
        : (
            <p className="max-w-2xl text-sm text-muted-foreground">
              There is no
              {' '}
              <code className="font-mono">{manifest.report.subject}</code>
              {' '}
              record
              {' '}
              {recordId}
              {' '}
              in this workspace, so there is no story to tell. Pick one from
              {' '}
              <Link href="/dashboard/p/backlog" className="underline">the Backlog</Link>
              .
            </p>
          )}
    </>
  );
}
