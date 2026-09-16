import { setRequestLocale } from 'next-intl/server';
import { AutonomyTable } from '@/features/dashboard/autonomy/AutonomyTable';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listPolicies } from '@/services/autonomy/AutonomyService';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * /dashboard/autonomy — the autonomy ladder, one row per action kind.
 *
 * Manifesto #8, "Automation is earned", as a page: where each kind stands
 * (Observe → Recommend → Assist → Execute with approval → Execute within
 * bounds → Operate autonomously), its risk tier, the confidence floor an
 * auto-execution needs, the alignment evidence behind it, and what the next
 * rung takes. Promote appears only when the evidence has earned it; demote is
 * always there. Every row's numbers come from the decisions people made in
 * the review queue and the inbox — deciding IS the evidence.
 */

export const dynamic = 'force-dynamic';

export default async function AutonomyPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  const { has } = await requireOrganization();
  const isAdmin = has({ role: ORG_ROLE.ADMIN });

  if (!orgId) {
    return <TitleBar title="Autonomy" description="Sign in to an organization to see its autonomy ladder." />;
  }

  const policies = await listPolicies(orgId);

  return (
    <>
      <TitleBar
        title="Autonomy"
        description="Where each action kind stands on the ladder, and what the next rung takes. Every decision you make in the review queue and the inbox is the evidence."
      />
      <AutonomyTable policies={policies} isAdmin={isAdmin} />
    </>
  );
}
