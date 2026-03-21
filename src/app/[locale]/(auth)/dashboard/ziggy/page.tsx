import { auth } from '@clerk/nextjs/server';
import { setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { ZiggyTabs } from '@/features/dashboard/ZiggyTabs';
import { getAgentConfig } from '@/services/AgentConfigService';

export default async function ZiggyPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();

  const config = orgId ? await getAgentConfig(orgId, 'ziggy') : null;

  return (
    <>
      <div className="flex items-start justify-between">
        <TitleBar
          title="Ziggy"
          description="Sales operations agent for MetaCTO. First packaged agent on the CoreContext platform."
        />
        <Badge variant="outline">Case Study</Badge>
      </div>

      <ZiggyTabs config={config} />
    </>
  );
}
