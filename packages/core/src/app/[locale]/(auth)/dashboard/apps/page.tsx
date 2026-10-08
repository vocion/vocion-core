import type { Metadata } from 'next';
import type { AppOffer } from '@/services/AppCatalogService';
import { LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatalogCard, CatalogCards } from '@/components/patterns';
import { EmptyState } from '@/components/ui/empty-state';
import { LetterTile } from '@/components/ui/letter-tile';
import { iconByName } from '@/features/dashboard/iconByName';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { listAppOffers } from '@/services/AppCatalogService';

export const metadata: Metadata = { title: 'Apps' };

/**
 * Apps — where "+ Add app" in the rail lands (Chris, 2026-10-08): one tinted
 * card per app the core ships (`templates/apps`, read, never named here), each
 * with one sentence, what it brings in labelled counts, and one action — Add
 * for an app this workspace does not have, Open for one it does. An added
 * app's card also links to its Features. Every card's page
 * (`/dashboard/apps/<id>`) has the app's features as On/Off switches.
 *
 * It replaced the Marketplace's Plugins tab: a plugin is an app's feature,
 * and the word "plugin" stays in the developer Details.
 * @param props
 * @param props.params
 */
export default async function AppsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const [{ orgId }, t] = await Promise.all([auth(), getTranslations('Apps')]);
  const apps = orgId ? await listAppOffers(orgId) : [];

  return (
    <>
      <TitleBar title={t('title')} description={t('description')} />
      {apps.length === 0
        ? <EmptyState icon={LayoutGrid} title={t('empty_title')} description={t('empty_body')} action={{ label: t('empty_action'), href: '/dashboard/hire' }} />
        : (
            <CatalogCards>
              {apps.map(app => <AppCard key={app.id} app={app} />)}
            </CatalogCards>
          )}
    </>
  );
}

/**
 * One app, as a front door on its tint.
 * @param props
 * @param props.app - The app as this workspace sees it.
 */
function AppCard({ app }: { app: AppOffer }) {
  const t = useTranslations('Apps');
  const summary = [
    app.agents.length > 0 ? t('summary_agents', { count: app.agents.length }) : null,
    app.pages.length > 0 ? t('summary_pages', { count: app.pages.length }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <CatalogCard
      tint={app.tint}
      lead={<LetterTile name={app.name} icon={iconByName(app.icon)} tint={app.tint} className="bg-background/70" />}
      kicker={app.added ? t('kicker_added') : t('kicker_app')}
      title={app.name}
      job={app.job}
      meta={summary || undefined}
      action={app.added ? { label: t('open'), href: app.href } : { label: t('add'), href: `/dashboard/apps/${app.id}` }}
      secondaryAction={app.added ? { label: t('features_link'), href: `/dashboard/apps/${app.id}` } : undefined}
    />
  );
}
