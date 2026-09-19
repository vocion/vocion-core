import type { Metadata } from 'next';
import type { CatalogEntry } from '@/services/CatalogService';
import { ArrowRight, Wand2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { createElement } from 'react';
import { CombinedPageHeader } from '@/features/dashboard/manage/CombinedPageHeader';
import { combinedPageTitle } from '@/features/navigation/combinedPages';
import { agentAccent } from '@/libs/agentAccents';
import { agentIcon } from '@/libs/agentIcons';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
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

export const metadata: Metadata = { title: combinedPageTitle('/dashboard/marketplace/agents') };

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
      <CombinedPageHeader active="/dashboard/marketplace/agents" description={t('agents_tab_description')} />

      {entries.length === 0
        ? <EmptyState hasCatalog={catalogSize > 0} />
        : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {entries.map(entry => <MarketplaceCard key={entry.slug} entry={entry} />)}
            </div>
          )}
    </>
  );
}

/**
 * One catalog entry. Same anatomy as the team card next door — hairline
 * border, accent dot, soft hover — rather than a second card style beside it.
 * @param root0 - Props.
 * @param root0.entry - The catalog entry to render.
 */
function MarketplaceCard({ entry }: { entry: CatalogEntry }) {
  const t = useTranslations('Marketplace');
  const a = agentAccent(entry.accent);

  return (
    <div className="group relative flex flex-col rounded-xl border border-border/70 p-5 transition-colors hover:bg-surface-hover">
      <div className="flex items-start gap-3">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-background"
          style={{ background: a.stripe }}
        >
          {createElement(agentIcon(entry.icon, { primary: true }), { 'className': 'size-4', 'aria-hidden': true })}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base leading-tight font-semibold">{entry.name}</h3>
          {entry.teamName && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{entry.teamName}</div>
          )}
        </div>
      </div>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{entry.description}</p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        <span className="text-[11px] text-muted-foreground">
          {t('skill_count', { count: entry.skills.length })}
        </span>
        <Link
          href={`/dashboard/marketplace/${entry.slug}`}
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-foreground transition-colors hover:text-primary sm:min-h-0"
        >
          {t('view_profile')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

/**
 * Two genuinely different outcomes, never one blank screen: everything has
 * been hired, or this deployment carries no catalog at all.
 * @param root0 - Props.
 * @param root0.hasCatalog - Whether any entries exist on disk.
 */
function EmptyState({ hasCatalog }: { hasCatalog: boolean }) {
  const t = useTranslations('Marketplace');

  if (!hasCatalog) {
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-6">
        <div className="text-sm font-semibold">{t('none_title')}</div>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('none_body')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 px-5 py-6">
      <div className="text-sm font-semibold">{t('empty_title')}</div>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t('empty_body')}</p>
      <Link
        href="/dashboard/chat?agent=automation-engineer"
        className="mt-3.5 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-action px-3.5 py-1.5 text-[13px] font-medium text-action-foreground transition-colors hover:bg-action/90 sm:min-h-0"
      >
        <Wand2 className="size-3.5" aria-hidden />
        {t('empty_action')}
      </Link>
    </div>
  );
}
