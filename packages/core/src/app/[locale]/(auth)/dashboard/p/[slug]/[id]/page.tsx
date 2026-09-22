import { setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { FeatureReportView } from '@/features/dashboard/factory/FeatureReportView';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { pagePlugin } from '@/libs/workspace/pages';
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
  if (!manifest || manifest.archetype !== 'report' || !manifest.report) {
    return notFound();
  }

  const recordId = Number(id);
  if (!Number.isInteger(recordId) || recordId <= 0) {
    return notFound();
  }

  const report = await loadFeatureReport(orgId, recordId);
  const ownedBy = pagePlugin(manifest);

  return (
    <>
      <TitleBar
        title={report ? report.title : manifest.title}
        description={report ? `Request ${report.requestId} — ${manifest.description ?? 'the whole story, in order.'}` : manifest.description}
      />
      {ownedBy && <PluginPanel orgId={orgId} slug={ownedBy} />}
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
