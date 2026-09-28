import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { FeatureReportView, ReportContextLine } from '@/features/dashboard/factory/FeatureReportView';
import { RecordChangeIntent } from '@/features/dashboard/objects/RecordChangeIntent';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { WikiView } from '@/features/dashboard/wiki/WikiView';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { loadFeatureReport } from '@/services/factory/featureReportData';
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
  // A run's own page (the Runs log's row link): the same preview a row opens,
  // full width, so a person reads where it stopped and why, and copies the
  // Claude Code block from it. One shape: the preview pane, not a second view.
  if (manifest?.source?.kind === 'workerRuns') {
    await import('@/services/preview/descriptors');
    const { resolvePreview } = await import('@/services/preview/registry');
    const { RunDetail } = await import('@/features/dashboard/factory/RunDetail');
    // `agent-<id>` is an agent run (mission_run) in the same log.
    const agentRun = /^agent-(\d+)$/.exec(id);
    const doc = await resolvePreview(agentRun ? { type: 'mission_run', id: agentRun[1]! } : { type: 'worker_run', id }, { orgId, userId: null });
    return (
      <>
        <TitleBar title={manifest.title} description={manifest.description} />
        <RunDetail doc={doc} backHref={`/dashboard/p/${manifest.slug}`} />
      </>
    );
  }
  // A product's OVERVIEW — what a Products card's name opens. Keyed on the
  // page's derivation rather than its slug: a page that derives a product
  // board is the products page, whatever a workspace called it.
  if (manifest?.derive === 'productBoard') {
    const { loadProductOverview } = await import('@/services/factory/productOverviewData');
    const { ProductOverviewView } = await import('@/features/dashboard/factory/ProductOverviewView');
    const now = new Date();
    const overview = await loadProductOverview(orgId, id, now);
    return overview
      ? <ProductOverviewView overview={overview} page={{ slug: manifest.slug, title: manifest.title }} now={now.getTime()} />
      : notFound();
  }
  if (!manifest || manifest.archetype !== 'report' || !manifest.report) {
    return notFound();
  }

  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return notFound();
  }

  const report = await loadFeatureReport(orgId, recordId);

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
              (report.goal ?? null) === null && report.context.length === 0
                ? undefined
                : (
                    <>
                      {report.goal}
                      <ReportContextLine bits={report.context} />
                    </>
                  )
            )
          : manifest.description}
      />
      {/* The workforce panel does NOT belong here. "5 measures · 4 agents · 14
          skills" is configuration for the whole factory, shown above one piece
          of work: "I clicked into one specific piece of work. Don't show me
          workforce configuration." It lives on the plugin's own pages. */}
      {report && <RecordChangeIntent objectId={report.requestId} title={report.title} selectionRoot={'[id^="report-"]'} />}
      {report
        ? <FeatureReportView report={report} />
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
