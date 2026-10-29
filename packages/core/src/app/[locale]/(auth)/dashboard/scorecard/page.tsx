import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ScorecardTable } from '@/features/scorecard/ScorecardTable';
import { WorkforcePerformance } from '@/features/scorecard/WorkforcePerformance';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * Agent scorecard — how each agent is doing, for anyone in the workspace.
 *
 * Unlike Adoption this page is not admin-only: it is the view a client's
 * business users open on their own (#342). `router.scorecard.agents` checks
 * only that the caller is signed in to this organization. The per-person
 * activity table stays on the admin Adoption page and is never rendered here.
 * @param props
 * @param props.params
 */
export default async function ScorecardPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { has } = await requireOrganization();

  return (
    <>
      <TitleBar
        title="Workforce performance"
        description="Agent activity, reviewed output, quality and cost — with measurement gaps made explicit"
      />
      {has({ role: ORG_ROLE.ADMIN }) ? <WorkforcePerformance /> : <ScorecardTable />}
    </>
  );
}
