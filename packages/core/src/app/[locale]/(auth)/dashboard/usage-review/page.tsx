import { MessageSquareText } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { Column, ListEmpty, ListPage, ListRow, ListRows, Subline } from '@/components/patterns';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { RunUsageReview } from '@/features/usageReview/RunUsageReview';
import { clerkAuth } from '@/libs/Auth';
import { READ_MODE_LABEL, READ_MODE_WHY_LABEL } from '@/services/usageReview/privacy';
import { listUsageReports } from '@/services/usageReview/reports';
import { ORG_ROLE } from '@/types/Auth';
import { requireOrganization } from '@/utils/Auth';

/**
 * /dashboard/usage-review — the Workspace manager's daily usage review, for
 * the workspace's admins (docs/guides/usage-review.md). Each row is one day's
 * report, outcome first: did people get where they wanted, how often they had
 * to ask again, and what got in the way. A row opens the report on Briefings,
 * where every claim links to its thread.
 */

export const dynamic = 'force-dynamic';

export default async function UsageReviewPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, has } = await requireOrganization();
  const { accountId } = await clerkAuth();
  if (!has({ role: ORG_ROLE.ADMIN })) {
    return <TitleBar title="Usage review" description="The daily usage review is for this workspace's admins." />;
  }
  const { on, mode, reports } = await listUsageReports(orgId, accountId ?? null);
  const description = `Each morning, whether yesterday's chats got people where they wanted, and what would fix the ones that did not. Read as ${READ_MODE_LABEL[mode.mode].toLowerCase()} (${READ_MODE_WHY_LABEL[mode.why]}).`;

  return (
    <ListPage title="Usage review" description={description} actions={on ? <RunUsageReview /> : undefined}>
      {reports.length === 0
        ? (
            <ListEmpty
              icon={MessageSquareText}
              title={on ? 'No reviews yet' : 'The Workspace manager is off'}
              description={on
                ? 'The first one is written the morning after people use this workspace.'
                : 'Turn on the Workspace manager plugin to get a daily read on how people use this workspace.'}
              action={on ? undefined : { label: 'Plugins', href: '/dashboard/plugins' }}
            />
          )
        : (
            <ListRows>
              {reports.map(r => (
                <ListRow
                  key={r.briefingId}
                  href={`/dashboard/briefings/${r.briefingId}`}
                  title={r.title}
                  subline={<Subline separator="·" segments={[r.summary, r.themes[0], r.readAs === 'content' ? 'content and metadata' : 'metadata only']} />}
                  columns={(
                    <>
                      <Column kind="number">{r.threads ?? '—'}</Column>
                      <Column kind="number">{r.outcomeRate === null ? '—' : `${r.outcomeRate}%`}</Column>
                      <Column kind="number">{r.reaskRate === null ? '—' : `${r.reaskRate}%`}</Column>
                    </>
                  )}
                />
              ))}
            </ListRows>
          )}
    </ListPage>
  );
}
