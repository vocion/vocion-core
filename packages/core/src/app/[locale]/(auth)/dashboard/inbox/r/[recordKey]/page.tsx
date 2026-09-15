import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AskSheet } from '@/features/dashboard/inbox/AskSheet';
import { agoLabel } from '@/features/dashboard/inbox/inboxMeta';
import { reviewRowToSheetAsk } from '@/features/dashboard/inbox/reviewRowToSheetAsk';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { listReviewRowsForRecord } from '@/services/inbox/reviewRows';

/**
 * One record's decision sheet: every proposed action about the same deal,
 * contact or address, answered as a stepper — approve or reject per item, a
 * receipt, one Submit all. Already-decided proposals about the record are
 * listed underneath as the history.
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
  const title = record ? `${record.name} — ${open.length} ${open.length === 1 ? 'proposal' : 'proposals'}` : 'Proposal';

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href="/dashboard/inbox" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        Needs you
      </Link>
      {open.length > 0
        ? <AskSheet asks={open.map(reviewRowToSheetAsk)} title={title} endpoint="review" allowOther={false} />
        : <TitleBar title={record?.name ?? 'Proposal'} description="Nothing open on this record." />}
      {decided.length > 0 && (
        <section className={open.length > 0 ? 'mt-8' : ''}>
          <h2 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Decided
            {' '}
            <span className="font-normal text-muted-foreground/70 tabular-nums">{decided.length}</span>
          </h2>
          <ul className="divide-y divide-border border-y border-border text-sm">
            {decided.map(r => (
              <li key={r.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.described.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.described.subline}</span>
                </span>
                <span className={`shrink-0 text-xs font-medium ${r.status === 'rejected' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {r.status === 'rejected' ? 'Rejected' : 'Approved'}
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{r.decidedAt ? agoLabel(r.decidedAt) : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
