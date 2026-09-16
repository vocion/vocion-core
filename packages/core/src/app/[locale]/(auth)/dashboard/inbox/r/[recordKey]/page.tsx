import { Inbox } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListEmpty } from '@/components/patterns';
import { decisionCrumbs, NEEDS_YOU_CRUMB } from '@/features/dashboard/inbox/inboxMeta';
import { RecordSheet } from '@/features/dashboard/inbox/RecordSheet';
import { recordSheetView } from '@/features/dashboard/inbox/recordSheetView';
import { reviewRowToSheetAsk } from '@/features/dashboard/inbox/reviewRowToSheetAsk';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { clerkAuth as auth } from '@/libs/Auth';
import { recordTitle } from '@/services/inbox/describeActionRun';
import { parseRecordKeyParam } from '@/services/inbox/recordKey';
import { listReviewRowsForRecord } from '@/services/inbox/reviewRows';

/**
 * One record's decision sheet: every proposed action about the same deal,
 * contact or address, answered as a stepper — approve or decline per item,
 * with everything already decided about the record listed underneath.
 *
 * Deciding stays on the record. The sheet moves to the record's next open
 * proposal and the decided one joins the list below; only when nothing is
 * left does it offer a button back to Needs you. `RecordSheet` owns both
 * halves so that stays true without waiting on a refetch.
 *
 * Arriving with nothing left is the same answer, not a missing page: the URL
 * was right and the work is finished, so it is an empty state named after the
 * record rather than the 404 it used to be (`services/inbox/recordKey.ts`
 * explains why the URL reached here at all).
 */

export const dynamic = 'force-dynamic';

export default async function RecordSheetPage(props: { params: Promise<{ locale: string; recordKey: string }> }) {
  const { locale, recordKey: raw } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const recordKey = parseRecordKeyParam(raw);
  const view = recordSheetView(recordKey, await listReviewRowsForRecord(orgId, recordKey));
  if (view.state === 'empty') {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ReviewHeader crumbs={decisionCrumbs('proposal', view.label)} title={view.label} system="Record" status="done" position="0 open" />
        <ListEmpty
          icon={Inbox}
          title="Nothing waiting on this record"
          description={`No open or decided proposals about ${view.label} any more.`}
          action={{ label: 'Back to Needs you', href: NEEDS_YOU_CRUMB.href }}
        />
      </div>
    );
  }
  const { open, decided } = view;
  const record = (open[0] ?? decided[0])!.described.record;
  const name = record ? recordTitle(record) : view.label;

  return (
    <RecordSheet
      open={open.map(reviewRowToSheetAsk)}
      decided={decided.map(r => ({
        id: r.id,
        title: r.described.title,
        subline: r.described.subline,
        status: r.status,
        decidedAt: r.decidedAt?.toISOString() ?? null,
      }))}
      title={name}
      crumbs={decisionCrumbs('proposal', name)}
    />
  );
}
