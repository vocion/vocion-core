import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DetailPage } from '@/components/patterns';
import { BrowserRunView } from '@/features/browser/BrowserRunView';
import { clerkAuth as auth } from '@/libs/Auth';
import { browserRunLabel } from '@/libs/browser/run';
import { readBrowserRun } from '@/services/browser/runReads';

export const metadata: Metadata = { title: 'Browser run' };

/**
 * One browser run, full width: the same live view the pane draws beside a
 * conversation (`features/browser/BrowserRunView`), with room for the page.
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function BrowserRunPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const runId = Number.parseInt(id, 10);
  if (!orgId || !userId || !Number.isSafeInteger(runId) || runId <= 0) {
    notFound();
  }
  const run = await readBrowserRun(orgId, runId);
  if (!run) {
    notFound();
  }
  return (
    <DetailPage crumbs={[{ label: 'Browser runs', href: '/dashboard/browser' }, { label: browserRunLabel(run.id) }]} title={browserRunLabel(run.id)} subtitle={run.task}>
      <div className="max-w-4xl">
        <BrowserRunView initial={run} compact />
      </div>
    </DetailPage>
  );
}
