import { Sparkles } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { PersonalConnections } from '@/features/personal/PersonalConnections';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectSystemsHref } from '@/libs/connect/systemsLink';
import { Link } from '@/libs/I18nNavigation';
import { connectInfoForOrg } from '@/services/connect/connectInfo';
import { ownPersonalWorkspace } from '@/services/personal/connections';
import { ORG_ROLE } from '@/types/Auth';

export default async function ConnectorsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId, has } = await auth();
  // In a person's own Personal workspace this page is theirs: their own
  // accounts, for their own assistant (docs/guides/personal-connections.md).
  if (orgId && userId && await ownPersonalWorkspace(orgId, userId)) {
    return (
      <>
        <TitleBar title="Connectors" description="Connect your own mail, calendar, files, Slack DMs and GitHub for your assistant." />
        <PersonalConnections />
      </>
    );
  }
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
