import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { BrowserRunList } from '@/features/browser/BrowserRunList';
import { clerkAuth as auth } from '@/libs/Auth';
import { recentBrowserRuns } from '@/services/browser/BrowserRunService';

export const metadata: Metadata = { title: 'Browser runs' };

/**
 * Your browser runs, newest first. A run is asked for in chat ("use the
 * browser to …"); this page is where they are kept, and where the practice
 * task shows the whole shape in one click.
 * @param props - The route.
 * @param props.params - Its params.
 */
export default async function BrowserRunsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId, userId } = await auth();
  const runs = orgId && userId ? await recentBrowserRuns(orgId, userId, 30) : [];
  return (
    <ListPage title="Browser runs" description="Tasks done in your browser on sites with no API: signed in, step by step, with anything that submits held for your approval.">
      <BrowserRunList runs={runs} />
    </ListPage>
  );
}
