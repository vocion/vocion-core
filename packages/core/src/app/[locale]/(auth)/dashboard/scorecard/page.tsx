import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ScorecardTable } from '@/features/scorecard/ScorecardTable';
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
  await requireOrganization();

  return (
    <>
      <TitleBar
        title="Scorecard"
        description="How each agent is doing — how often people go with its recommendations, how sure it is, and how much it is used"
      />
      <ScorecardTable />
    </>
  );
}
