import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { decisionCrumbs } from '@/features/dashboard/inbox/inboxMeta';
import { RecordSheet } from '@/features/dashboard/inbox/RecordSheet';
import { reviewRowToSheetAsk } from '@/features/dashboard/inbox/reviewRowToSheetAsk';
import { clerkAuth as auth } from '@/libs/Auth';
import { recordTitle } from '@/services/inbox/describeActionRun';
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
 */

export const dynamic = 'force-dynamic';

export default async function RecordSheetPage(props: { params: Promise<{ locale: string; recordKey: string }> }) {
  const { locale, recordKey: raw } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const recordKey = decodeURIComponent(raw);
  const { open, decided } = await listReviewRowsForRecord(orgId, recordKey);
  if (open.length === 0 && decided.length === 0) {
    notFound();
  }
  const record = (open[0] ?? decided[0])!.described.record;
  const name = record ? recordTitle(record) : 'Proposal';

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
