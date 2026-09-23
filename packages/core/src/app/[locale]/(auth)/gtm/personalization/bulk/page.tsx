import { setRequestLocale } from 'next-intl/server';
import { ListPage, parseListState } from '@/components/patterns';
import { BulkActionsView } from '@/features/personalization/BulkActionsView';
import { describeQueueView, filterQueueRowsNow, QUEUE_LIST } from '@/features/personalization/queueFilter';
import { loadQueueBriefRows } from '@/features/personalization/queueRows';
import { clerkAuth as auth } from '@/libs/Auth';
import { BULK_MAX_LEADS } from '@/services/personalization/bulkRegenerate';

/**
 * The bulk actions view (Metacto ticket 071). Opens on the leads the queue
 * was showing: the URL state the queue keeps (lane, search, briefed-window
 * chips) comes along on the link, and the same filter runs here.
 * @param props
 * @param props.params
 * @param props.searchParams
 */
export default async function BulkActionsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    return null;
  }
  const sp = await props.searchParams;
  const search = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : v === undefined ? [] : [[k, v]])) as [string, string][]).toString();
  const state = parseListState(search, QUEUE_LIST);
  const view = { lane: state.tab, q: state.q, chips: state.chips };
  const rows = filterQueueRowsNow(await loadQueueBriefRows(orgId), view);

  return (
    <ListPage
      title="Bulk actions"
      description="One action on every lead the queue was showing. Each lead is worked in turn on the work queue, and the next page shows each one land."
    >
      <BulkActionsView rows={rows} viewLabel={describeQueueView(view)} max={BULK_MAX_LEADS} />
    </ListPage>
  );
}
