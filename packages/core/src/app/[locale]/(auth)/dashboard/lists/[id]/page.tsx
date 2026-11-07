import { setRequestLocale } from 'next-intl/server';
import { ListsWorkspace } from '@/features/dashboard/lists/ListsWorkspace';

export default async function ListPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  return <ListsWorkspace id={id} />;
}
