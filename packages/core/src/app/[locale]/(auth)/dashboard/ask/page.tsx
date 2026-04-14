import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { AskChat } from '@/features/dashboard/AskChat';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function AskPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Ask' });

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between">
        <TitleBar title={t('title')} description={t('description')} />
        <Badge variant="secondary">Live</Badge>
      </div>
      <AskChat />
    </div>
  );
}
