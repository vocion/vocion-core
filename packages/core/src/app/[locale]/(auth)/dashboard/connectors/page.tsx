import { getTranslations, setRequestLocale } from 'next-intl/server';
import { SourcesPanel } from '@/features/dashboard/SourcesPanel';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { PersonalConnections } from '@/features/personal/PersonalConnections';
import { clerkAuth as auth } from '@/libs/Auth';
import { connectInfoForOrg } from '@/services/connect/connectInfo';
import { connectionsOverview } from '@/services/connect/connectionsOverview';
import { otherKindHref } from '@/services/connect/connectorKindRouting';
import { ownPersonalWorkspace } from '@/services/personal/connections';
import { ORG_ROLE } from '@/types/Auth';

/**
 * Connectors, in either of their two kinds (`libs/connect/connectorKinds.ts`):
 * Team connectors in a shared workspace — the systems its agents use, managed
 * by an admin — and Personal connectors in a person's own Personal workspace.
 * One line under the title says whose they are, with one quiet link to the
 * other kind; the rest is the list.
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
    const teamHref = await otherKindHref({ orgId, userId, workspace: 'personal' }).catch(() => null);
    return (
      <>
        <TitleBar title={t('personal_title')} description={<ScopeLine line={t('personal_line')} link={teamHref ? { href: teamHref, label: t('team_link') } : null} />} />
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
        description={<ScopeLine line={t('shared_line')} link={overview.personalHref ? { href: overview.personalHref, label: t('personal_link') } : null} />}
      />
      <SourcesPanel connectInfo={connectInfo} overview={overview} isAdmin={isAdmin} />
    </>
  );
}

/**
 * Whose connectors these are, in one line, and one quiet link to the other
 * kind (`libs/connect/connectorKinds.ts`).
 * @param props - The line and the link.
 * @param props.line - Whose they are.
 * @param props.link - The other kind's page, when there is one to link.
 */
function ScopeLine({ line, link }: { line: string; link: { href: string; label: string } | null }) {
  return (
    <span data-testid="connectors-scope-line">
      {line}
      {link && (
        <>
          {' '}
          {/* A plain link: the other kind lives in another workspace, and
              switching workspace is a full load through its /w/ entry route. */}
          <a href={link.href} className="underline decoration-border underline-offset-2 hover:text-foreground">
            {`${link.label} →`}
          </a>
        </>
      )}
    </span>
  );
}
