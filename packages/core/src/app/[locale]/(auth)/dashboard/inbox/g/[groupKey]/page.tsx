import { ArrowLeft } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AskReceipt } from '@/features/dashboard/inbox/AskReceipt';
import { AskSheet } from '@/features/dashboard/inbox/AskSheet';
import { toSheetAsk } from '@/features/dashboard/inbox/toSheetAsk';
import { clerkAuth as auth } from '@/libs/Auth';
import { Link } from '@/libs/I18nNavigation';
import { agentKeyOf, scoresByAgentAndKey } from '@/services/alignment/AlignmentService';
import { listAskGroup } from '@/services/AskService';

/**
 * A decision sheet — every ask under one `groupKey`, answered as a stepper:
 * one question per screen, a receipt at the end, one "Submit all". Asks
 * already answered are listed underneath as the record.
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
  // The asker's alignment on each kind, for the line under the question.
  const alignment = await scoresByAgentAndKey(orgId, '30d', new Date(), 'ask');
  const sheet = open.map(a => toSheetAsk(a, alignment.get(agentKeyOf(a.agentSlug, a.kind)) ?? null));
  const decided = asks.filter(a => a.status !== 'open');
  const title = asks.find(a => a.groupTitle)?.groupTitle ?? groupKey;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link href="/dashboard/inbox" className="mb-3 inline-flex min-h-10 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        Needs you
      </Link>
      {open.length > 0
        ? <AskSheet asks={sheet} title={title} />
        : (
            <header className="mb-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Decision sheet · answered</p>
              <h1 className="text-xl font-semibold">{title}</h1>
            </header>
          )}
      {decided.length > 0 && (
        <section className={open.length > 0 ? 'mt-8' : ''}>
          <h2 className="mb-1.5 px-1 text-sm font-semibold">
            Answered
            {' '}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{decided.length}</span>
          </h2>
          <div className="divide-y divide-border rounded-md border border-border">
            {decided.map(a => <AskReceipt key={a.id} ask={a} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}
