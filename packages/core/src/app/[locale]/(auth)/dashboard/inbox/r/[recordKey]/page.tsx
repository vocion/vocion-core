import { Inbox } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListEmpty } from '@/components/patterns';
import { decisionCrumbs, REVIEW_CRUMB } from '@/features/dashboard/inbox/inboxMeta';
import { RecordSheet } from '@/features/dashboard/inbox/RecordSheet';
import { recordSheetView } from '@/features/dashboard/inbox/recordSheetView';
import { reviewRowToSheetAsk } from '@/features/dashboard/inbox/reviewRowToSheetAsk';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { workCardModel } from '@/features/review/reviewSheetModel';
import { clerkAuth as auth } from '@/libs/Auth';
import { emailPreviewFrom } from '@/services/inbox/emailPreview';
import { parseRecordKeyParam } from '@/services/inbox/recordKey';
import { loadReviewContext } from '@/services/inbox/reviewContext';
import { listReviewRowsForRecord } from '@/services/inbox/reviewRows';

/**
 * One record's decision sheet: every proposed action about the same deal,
 * contact or address, answered as a stepper — approve or decline per item,
 * with everything already decided about the record listed underneath.
 *
 * Deciding stays on the record. The sheet moves to the record's next open
 * proposal and the decided one joins the list below; only when nothing is
 * left does it offer a button back to the review queue. `RecordSheet` owns both
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
          description={`No open or decided recommendations about ${view.label} any more.`}
          action={{ label: 'Back to the review queue', href: REVIEW_CRUMB.href }}
        />
      </div>
    );
  }
  const { open, decided, name } = view;
  // What the reviewer needs to decide, read once on the server: the payload as
  // the thing it is (`workCardModel`), why it is here and its facts, and the
  // record's own context (CRM, mailbox mirror, sequence) for the pane. The
  // context read is capped — it calls out to the CRM — and the pane says which
  // sections could not be read rather than hiding them.
  const contextRows = open.slice(0, 3);
  const contexts = Object.fromEntries(await Promise.all(contextRows.map(async r => [r.id, await loadReviewContext(orgId, r)] as const)));
  const reasons = Object.fromEntries(open.map(r => [r.id, {
    reason: r.described.rationale,
    runId: r.id,
    since: r.createdAt.toISOString(),
    agentSlug: r.described.agentSlug,
    confidence: r.described.confidence,
    actionKind: r.described.actionKind,
    changes: r.described.changes,
  }] as const));
  const works = Object.fromEntries(open.map(r => [r.id, workCardModel({
    actionId: r.actionId,
    actionKind: r.described.actionKind,
    input: r.input,
    changes: r.described.changes,
    email: emailPreviewFrom(r.actionId, r.input),
  })] as const));
  const inputs = Object.fromEntries(open.map(r => [r.id, r.input] as const));

  return (
    <RecordSheet
      reasons={reasons}
      works={works}
      inputs={inputs}
      contexts={contexts}
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
