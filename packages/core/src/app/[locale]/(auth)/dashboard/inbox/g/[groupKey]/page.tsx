import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AskReceipt } from '@/features/dashboard/inbox/AskReceipt';
import { AskSheet } from '@/features/dashboard/inbox/AskSheet';
import { decisionCrumbs } from '@/features/dashboard/inbox/inboxMeta';
import { toSheetAsk } from '@/features/dashboard/inbox/toSheetAsk';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { clerkAuth as auth } from '@/libs/Auth';
import { agentKeyOf, scoresByAgentAndKey } from '@/services/alignment/AlignmentService';
import { listAskGroup } from '@/services/AskService';
import { kindForAsk } from '@/services/InboxService';

/**
 * A decision sheet — every ask under one `groupKey`, answered as a stepper:
 * one question per screen, a receipt at the end, one "Submit all". Wears the
 * same chrome as a single decision (Needs you › kind › sheet). Asks already
 * answered are listed underneath as the record.
 */

export const dynamic = 'force-dynamic';

export default async function AskGroupPage(props: { params: Promise<{ locale: string; groupKey: string }> }) {
  const { locale, groupKey: raw } = await props.params;
  setRequestLocale(locale);
  const { orgId } = await auth();
  if (!orgId) {
    notFound();
  }
  const groupKey = decodeURIComponent(raw);
  const asks = await listAskGroup(orgId, groupKey);
  if (asks.length === 0) {
    notFound();
  }
  const open = asks.filter(a => a.status === 'open');
  // The asker's alignment on each kind, for the meta row under the question.
  const alignment = await scoresByAgentAndKey(orgId, '30d', new Date(), 'ask');
  const sheet = open.map(a => toSheetAsk(a, alignment.get(agentKeyOf(a.agentSlug, a.kind)) ?? null));
  const decided = asks.filter(a => a.status !== 'open');
  const title = asks.find(a => a.groupTitle)?.groupTitle ?? groupKey;
  const kind = kindForAsk((open[0] ?? asks[0]!).kind);

  return (
    <div className="mx-auto w-full max-w-3xl">
      {open.length > 0
        ? <AskSheet asks={sheet} title={title} kind={kind} crumbs={decisionCrumbs(kind, title)} />
        : <ReviewHeader crumbs={decisionCrumbs(kind, title)} title={title} system="Decision sheet" status="done" position={`${decided.length} answered`} />}
      {decided.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1.5 px-1 text-sm font-semibold">
            Answered
            {' '}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{decided.length}</span>
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {decided.map(a => <AskReceipt key={a.id} ask={a} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}
