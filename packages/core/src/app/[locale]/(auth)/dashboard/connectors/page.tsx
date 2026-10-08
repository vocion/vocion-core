import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectSystemsHref } from '@/libs/connect/systemsLink';
import { Link } from '@/libs/I18nNavigation';
import { connectInfoForOrg } from '@/services/connect/connectInfo';
import { ORG_ROLE } from '@/types/Auth';

export default async function ConnectorsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await auth();
  const connectInfo = orgId ? await connectInfoForOrg(orgId) : {};

  return (
    <>
      <TitleBar
        title="Connectors"
        description="Connect the tools your team already uses, so agents can read and search them."
        // The other way in: your assistant ranks what to connect from what this
        // workspace already uses and walks you through each, in chat.
        actions={orgId && has({ role: ORG_ROLE.ADMIN })
          ? (
              <Link href={connectSystemsHref()} data-testid="connectors-setup-with-assistant" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover">
                <Sparkles className="size-4" aria-hidden />
                Set up with your assistant
              </Link>
            )
          : undefined}
      />
      <SourcesPanel connectInfo={connectInfo} />
    </>
  );
}
