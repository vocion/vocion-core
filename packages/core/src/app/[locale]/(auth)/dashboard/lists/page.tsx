import { setRequestLocale } from 'next-intl/server';
import { ListsWorkspace } from '@/features/dashboard/lists/ListsWorkspace';

export default async function ListsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ListsWorkspace />;
}
