import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { CombinedPageHeader } from '@/features/dashboard/manage/CombinedPageHeader';
import { combinedPageTitle } from '@/features/navigation/combinedPages';
import { ToolCatalogView } from '@/features/tools/ToolCatalogView';
import { toolCatalogForOrg } from '@/libs/tools/orgCatalog';
import { requireOrganization } from '@/utils/Auth';

/**
 * The Tools tab of "Skills & tools" — see `skills/page.tsx`.
 *
 * What this workspace's agents can actually reach: the six built-ins, the
 * typed filing tools of its object types, each source family it has
 * connected (HubSpot, Apollo, Gmail, Calendar, Zoom, PostHog), every `rest`
 * source with its reads and its writes, and the workspace's own tools —
 * from the same registry and the same context the agents run with
 * (`toolCatalogForOrg`), so the page and the model never disagree about
 * what a tool is called or who holds it.
 */
export const metadata: Metadata = { title: combinedPageTitle('/dashboard/tools') };

export default async function ToolsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  const { orgId } = await requireOrganization();
  const catalog = await toolCatalogForOrg(orgId);

  return (
    <>
      <CombinedPageHeader
        active="/dashboard/tools"
        description="Every tool this workspace's agents can reach, by where it comes from: the built-ins every agent has, the records they file, each connected source, and any REST API declared as a source — with who holds it and whether it can run. Paid providers run on this workspace's own key when it has stored one, and on the Vocion server key otherwise."
      />
      <ToolCatalogView catalog={catalog} />
    </>
  );
}
