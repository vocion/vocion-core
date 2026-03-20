import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { AskChat } from '@/features/dashboard/AskChat';
import { TitleBar } from '@/features/dashboard/TitleBar';

export default async function ChatPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between">
        <TitleBar title="Chat" description="Talk to your agents, grounded in enterprise context" />
        <Badge variant="secondary">Live</Badge>
      </div>
      <AskChat />
    </div>
  );
}
