import { setRequestLocale } from 'next-intl/server';
import { ListPage, parseListState } from '@/components/patterns';
import { BulkActionsView } from '@/features/personalization/BulkActionsView';
import { QUEUE_LIST, queueNow } from '@/features/personalization/queueFilter';
import { loadQueueBriefRows } from '@/features/personalization/queueRows';
import { clerkAuth as auth } from '@/libs/Auth';

/**
 * The bulk actions view (Metacto tickets 071 and 076). Opens on the leads the
 * queue was showing, selected: the URL state the queue keeps (lane, search,
 * briefed-window chips) comes along on the link and seeds the page's own
 * filters. Every loaded row goes to the view, so a filter widened here finds
 * leads the queue link had narrowed away.
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
  const initial = { lane: state.tab, q: state.q, chips: state.chips, rung: '', magnet: '', before: '' };
  const rows = await loadQueueBriefRows(orgId);

  return (
    <ListPage
      title="Bulk actions"
      description="One action on the leads you select. It opens on the leads the queue was showing; filter and tick from there. Each lead is worked in turn on the work queue, and the next page shows each one land."
    >
      <BulkActionsView rows={rows} initial={initial} now={queueNow()} />
    </ListPage>
  );
}
