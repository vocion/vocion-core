import type { Metadata } from 'next';
import type { CatalogEntry } from '@/services/CatalogService';
import { Store, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { CatalogCard, CatalogCards, firstSentence } from '@/components/patterns';
import { AgentDot } from '@/components/ui/agent-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { CombinedPageHeader } from '@/features/dashboard/manage/CombinedPageHeader';
import { combinedPageTitle } from '@/features/navigation/combinedPages';
import { clerkAuth as auth } from '@/libs/Auth';
import { listCatalog, listUnhired } from '@/services/CatalogService';

/**
 * Marketplace · Agents for hire — the second tab: the catalog roles this
 * workspace has not hired yet. Hiring happens on the profile
 * (`/dashboard/marketplace/<slug>`), where somebody has actually seen what
 * they are hiring, so a card carries a role, its description and a link — no
 * readiness badge and no counts of what an implementation still has to author,
 * because browsing a catalog is reading.
 *
 * A static segment under `/dashboard/marketplace`, so it shadows the agent
 * profile's `[slug]` — `catalog-reserved-segments.test.ts` pins that no
 * catalog entry is ever slugged `agents`.
 */

export const metadata: Metadata = { title: combinedPageTitle('/dashboard/marketplace') };

export default async function MarketplaceAgentsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const entries = orgId ? await listUnhired(orgId) : listCatalog();
  // Distinguishes "you have hired everything" from "this deployment has no
  // catalog" — two very different empty states that must not share a screen.
  const catalogSize = listCatalog().length;

  return <AgentsForHireScreen entries={entries} catalogSize={catalogSize} />;
}

/**
 * Sync wrapper so the body can use `useTranslations` (RSC-safe); the async
 * page above only awaits data.
 * @param root0 - Props.
 * @param root0.entries - Catalog entries not yet hired.
 * @param root0.catalogSize - Total entries on disk, to tell the empty states apart.
 */
function AgentsForHireScreen({ entries, catalogSize }: { entries: CatalogEntry[]; catalogSize: number }) {
  const t = useTranslations('Marketplace');

  return (
    <>
      <CombinedPageHeader active="/dashboard/marketplace" description={t('agents_tab_description')} />

      {entries.length === 0
        ? <MarketplaceEmpty hasCatalog={catalogSize > 0} />
        : (
            <CatalogCards>
              {entries.map(entry => <MarketplaceCard key={entry.slug} entry={entry} />)}
            </CatalogCards>
          )}
    </>
  );
}

/**
 * One catalog entry, as a front door (`CatalogCard`): the agent's dot, its
 * team as the kicker, its role, one sentence of what it does, and the one
 * arrow into the profile where hiring happens. The skill count stays on the
 * profile — browsing a catalog is reading, not comparing.
 * @param root0 - Props.
 * @param root0.entry - The catalog entry to render.
 */
function MarketplaceCard({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('Marketplace');
  return (
    <CatalogCard
      lead={<AgentDot name={entry.name} accent={entry.accent} size="lg" decorative />}
      kicker={entry.teamName ?? t('agent_kicker')}
      title={entry.name}
      job={firstSentence(entry.description)}
      action={{ label: t('view_profile'), href: `/dashboard/marketplace/${entry.slug}` }}
    />
  );
}

/**
 * Two genuinely different outcomes, never one blank screen: everything has
 * been hired, or this deployment carries no catalog at all. Both are the one
 * `EmptyState`: a title, one sentence, one action.
 * @param root0 - Props.
 * @param root0.hasCatalog - Whether any entries exist on disk.
 */
function MarketplaceEmpty({ hasCatalog }: { hasCatalog: boolean }) {
  const t = useTranslations('Marketplace');
  return hasCatalog
    ? <EmptyState icon={Wand2} title={t('empty_title')} description={t('empty_body')} action={{ label: t('empty_action'), href: '/dashboard/chat?agent=automation-engineer' }} />
    : <EmptyState icon={Store} title={t('none_title')} description={t('none_body')} />;
}
