import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AskReceipt } from '@/features/dashboard/inbox/AskReceipt';
import { AskSheet } from '@/features/dashboard/inbox/AskSheet';
import { toSheetAsk } from '@/features/dashboard/inbox/toSheetAsk';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { scoreFor } from '@/services/alignment/AlignmentService';
import { getAsk } from '@/services/AskService';

/**
 * One ask — the question screen while it is open, the receipt once answered.
 * An ask that belongs to a decision sheet is still answerable alone from here.
 */

export const dynamic = 'force-dynamic';

export default async function AskPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId || !/^\d+$/.test(id)) {
    notFound();
  }
  const ask = await getAsk(orgId, Number.parseInt(id, 10));
  if (!ask) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href="/dashboard/inbox" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        Needs you
      </Link>
      {ask.groupKey && (
        <p className="mb-3 text-xs text-muted-foreground">
          Part of
          {' '}
          <Link href={`/dashboard/inbox/g/${encodeURIComponent(ask.groupKey)}`} className="underline-offset-2 hover:underline">{ask.groupTitle ?? 'a decision sheet'}</Link>
          .
        </p>
      )}
      {ask.status === 'open'
        ? <AskSheet asks={[toSheetAsk(ask, await scoreFor({ orgId, subjectKey: ask.kind, agentSlug: ask.agentSlug }))]} />
        : (
            <>
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Answered</p>
              <AskReceipt ask={ask} />
              <p className="mt-4 text-xs text-muted-foreground">
                Filed
                {' '}
                {ask.createdAt.toLocaleString()}
                {ask.createdBy ? ` by ${ask.createdBy}` : ''}
                {ask.sourceRef ? ` · ${ask.sourceRef}` : ''}
                {` · /api/v1/asks/${ask.id}`}
              </p>
            </>
          )}
    </div>
  );
}
