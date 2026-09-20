import type { Metadata } from 'next';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { CombinedPageHeader } from '@/features/dashboard/manage/CombinedPageHeader';
import { PluginRows } from '@/features/dashboard/plugins/PluginRows';
import { combinedPageTitle } from '@/features/navigation/combinedPages';
import { clerkAuth as auth } from '@/libs/Auth';
import { ORG_ROLE } from '@/types/Auth';

/**
 * Marketplace · Plugins — the first tab of the one place you go to ADD
 * capability (Chris, 2026-09-19: "Teams/Agents = where you go to see your
 * agents and capabilities. Marketplace = where you go to add capability (hire
 * agents, enable plugins)"). Teams & agents is the workforce you already have;
 * nothing acquisitive belongs there.
 *
 * It used to be one long page — a plugin list, then a grid of every agent
 * nobody had hired — with a "See also" row on top of it. Two lists that answer
 * two questions are two tabs (Chris, 2026-09-18: "Make Teams/Agents and
 * Plugins tabs and/or sub-pages for Marketplace"), each its own registered
 * route so a deep link, a pin and the breadcrumb all still work.
 *
 * The plugin list stays on `/dashboard/marketplace` itself rather than moving
 * to a sub-route, so the 308 from `/dashboard/plugins` — which is in pinned
 * entries, in chat's "turn a plugin on" answer and in links people already
 * sent — still lands on the plugins, not beside them. `/dashboard/plugins/<slug>`
 * is untouched, and `PluginRows` is the same component that page links back
 * to, with the same toggle, dependents warning and read-only blocker.
 */

export const metadata: Metadata = { title: combinedPageTitle('/dashboard/marketplace/plugins') };

export default async function MarketplacePluginsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await auth();

  return <PluginsScreen orgId={orgId ?? null} isAdmin={has({ role: ORG_ROLE.ADMIN })} />;
}

/**
 * Sync wrapper so the body can use `useTranslations` (RSC-safe); the async
 * page above only awaits the session.
 * @param root0 - Props.
 * @param root0.orgId - The project, when the session carries one.
 * @param root0.isAdmin - Whether this viewer may turn a plugin on or off.
 */
function PluginsScreen({ orgId, isAdmin }: { orgId: string | null; isAdmin: boolean }) {
  const t = useTranslations('Marketplace');

  return (
    <>
      <CombinedPageHeader active="/dashboard/marketplace/plugins" description={t('plugins_tab_description')} />
      {orgId && <PluginRows orgId={orgId} isAdmin={isAdmin} />}
    </>
  );
}
