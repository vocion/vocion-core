import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { WorkspacesList } from '@/features/dashboard/nav/WorkspacesList';

/**
 * All workspaces — where the workspace switcher's "All workspaces →" goes.
 * @param props - The route.
 * @param props.params - Its locale.
 */
export default async function WorkspacesPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'WorkspacesPage' });
  return (
    <ListPage title={t('title')} description={t('description')}>
      <WorkspacesList />
    </ListPage>
  );
}
