import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { PersonalConnections } from '@/features/personal/PersonalConnections';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { connectInfoForOrg } from '@/services/connect/connectInfo';
import { connectionsOverview } from '@/services/connect/connectionsOverview';
import { ownPersonalWorkspace } from '@/services/personal/connections';
import { ORG_ROLE } from '@/types/Auth';

/**
 * The workspace's shared connections (founder, 2026-10-09: "clear, concise,
 * simple, easy to use"). One line under the title says whose they are and
 * where a person's own accounts go instead; the rest is the list
 * (`features/dashboard/connectors/ConnectorList.tsx`).
 * @param props
 * @param props.params
 */
export default async function ConnectorsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations('Connectors');
  const { orgId, userId, accountId, has } = await auth();
  // In a person's own Personal workspace this page is theirs: their own
  // accounts, for their own assistant (docs/guides/personal-connections.md).
  if (orgId && userId && await ownPersonalWorkspace(orgId, userId)) {
    return (
      <>
        <TitleBar title={t('title')} description="Connect your own mail, calendar, files, Slack DMs and GitHub for your assistant." />
        <PersonalConnections />
      </>
    );
  }
  const isAdmin = Boolean(orgId) && has({ role: ORG_ROLE.ADMIN });
  const connectInfo = orgId ? await connectInfoForOrg(orgId) : {};
  const overview = orgId
    ? await connectionsOverview({ orgId, userId, accountId, isAdmin, connectInfo })
    : { recommended: [], usedBy: {}, unavailable: [], personalHref: null };

  return (
    <>
      <TitleBar
        title={t('title')}
        description={(
          <span data-testid="connectors-scope-line">
            {t('shared_line')}
            {overview.personalHref && (
              <>
                {' '}
                <Link href={overview.personalHref} className="underline decoration-border underline-offset-2 hover:text-foreground">
                  {`${t('personal_link')} →`}
                </Link>
              </>
            )}
          </span>
        )}
      />
      <SourcesPanel connectInfo={connectInfo} overview={overview} isAdmin={isAdmin} />
    </>
  );
}
