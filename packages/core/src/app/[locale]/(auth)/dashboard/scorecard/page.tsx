import { setRequestLocale } from 'next-intl/server';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ScorecardTable } from '@/features/scorecard/ScorecardTable';
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
        title="Agent scorecard"
        description="Human agreement, agent confidence, and recorded model cost in this workspace"
      />
      <ScorecardTable />
      {has({ role: ORG_ROLE.ADMIN }) && (
        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <a href="https://transform.vocion.ai" target="_blank" rel="noreferrer" className="underline">Open Vocion Transform</a>
          <a href="/api/v1/transform/export?days=7" className="underline">Export 7-day Transform snapshot</a>
          <a href="/api/v1/transform/export?days=30" className="underline">Export 30-day Transform snapshot</a>
        </div>
      )}
    </>
  );
}
