import type { Metadata } from 'next';
import type { McpSignIn } from '@/features/tools/McpSignInControl';
import { setRequestLocale } from 'next-intl/server';
import { CombinedPageHeader } from '@/features/dashboard/manage/CombinedPageHeader';
import { combinedPageTitle } from '@/features/navigation/combinedPages';
import { PersonalMcpOffers } from '@/features/tools/PersonalMcpOffers';
import { ToolCatalogView } from '@/features/tools/ToolCatalogView';
import { clerkAuth as auth } from '@/libs/Auth';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { toolCatalogForOrg } from '@/libs/tools/orgCatalog';
import { personalMcpOffers } from '@/services/outboundMcp/personalEnable';
import { personSignedIn, signInPath } from '@/services/outboundMcp/personSignIn';
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
  const { userId } = await auth();
  // Only a person's own Personal gets offers; anywhere else this is empty.
  const [catalog, offers] = await Promise.all([toolCatalogForOrg(orgId), userId ? personalMcpOffers(userId, orgId).catch(() => []) : []]);
  // The caller's own sign-in to each per-person MCP server, with Disconnect.
  const mcpSlugs = catalog.families.filter(f => f.kind === 'mcp').flatMap(f => f.sources.map(s => s.slug));
  const signIns: Record<string, McpSignIn> = {};
  if (userId && mcpSlugs.length > 0) {
    for (const source of await loadMcpSources(orgId, mcpSlugs)) {
      if (source.config.auth === 'person' && source.config.url) {
        signIns[`mcp:${source.slug}`] = { source: source.slug, signedIn: await personSignedIn(userId, source.config.url), signInHref: signInPath({ orgId, slug: source.slug }, { returnTo: '/dashboard/tools' }) };
      }
    }
  }

  return (
    <>
      <CombinedPageHeader
        active="/dashboard/tools"
        description="Every tool this workspace's agents can reach, by where it comes from: the built-ins every agent has, the records they file, each connected source, and any REST API or remote MCP server declared as a source — with who holds it and whether it can run. Paid providers run on this workspace's own key when it has stored one, and on the Vocion server key otherwise."
      />
      <PersonalMcpOffers offers={offers} />
      <ToolCatalogView catalog={catalog} signIns={signIns} />
    </>
  );
}
