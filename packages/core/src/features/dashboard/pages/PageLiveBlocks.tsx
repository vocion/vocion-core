import { getTranslations } from 'next-intl/server';
import { HomeDecisions } from '@/features/dashboard/appHome/HomeDecisions';
import { DashboardCardView } from '@/libs/cards/firstParty/dashboard';
import { dashboardSpecSchema } from '@/libs/dashboards/spec';
import { Link } from '@/libs/I18nNavigation';

/**
 * A page's `needsYou` and `dashboard` blocks (`libs/workspace/pageFields.ts`):
 * two pieces core already draws, placed on any page. Needs you is the app
 * home's (`HomeDecisions`: the one decision card, oldest first, decided in
 * place); the dashboard is the dashboard artifact's own view. Neither has a
 * second look here (principle 6), and each renders nothing when it has
 * nothing.
 */

/**
 * What waits on the person looking, from anyone in the workspace.
 * @param props
 * @param props.orgId - The workspace.
 * @param props.userId - The person.
 * @param props.title - The block's eyebrow, when the page names one.
 */
export async function NeedsYouBlock({ orgId, userId, title }: { orgId: string; userId: string; title: string | null }) {
  const { decisionsFromAgents } = await import('@/services/decisions/DecisionService');
  const [decisions, t] = await Promise.all([decisionsFromAgents(orgId, userId, null).catch(() => []), getTranslations('AppHome')]);
  if (decisions.length === 0) {
    return null;
  }
  return (
    <div className="mb-8">
      <HomeDecisions
        decisions={decisions}
        agentNames={{}}
        labels={{ title: title ?? t('needs_you'), inChat: t('needs_you_in_chat'), openChat: t('needs_you_open_chat'), failed: t('needs_you_failed') }}
      />
    </div>
  );
}

/**
 * The newest dashboard filed under a title, drawn whole, with its history one link away.
 * @param props
 * @param props.orgId - The workspace.
 * @param props.dashboard - Its title.
 * @param props.title - A heading to use instead of the dashboard's own.
 */
export async function DashboardBlock({ orgId, dashboard, title }: { orgId: string; dashboard: string; title: string | null }) {
  const { listArtifacts } = await import('@/services/ArtifactService');
  const found = (await listArtifacts({ orgId, kinds: ['dashboard'], search: dashboard, visibility: 'all', limit: 20 }).catch(() => []))
    .find(a => a.title.trim().toLowerCase() === dashboard.trim().toLowerCase());
  const parsed = found ? dashboardSpecSchema.safeParse(found.spec) : null;
  if (!found || !parsed?.success) {
    return null;
  }
  return (
    <section className="mt-10 mb-10 space-y-4" data-testid="page-dashboard" aria-label={title ?? parsed.data.title}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-foreground">{title ?? parsed.data.title}</h2>
        <Link href={`/dashboard/artifacts/${found.id}`} className="text-[12px] text-muted-foreground hover:text-foreground">History and sharing</Link>
      </header>
      <DashboardCardView data={{ ...parsed.data, __artifactId: found.id }} surface="artifact" />
    </section>
  );
}
