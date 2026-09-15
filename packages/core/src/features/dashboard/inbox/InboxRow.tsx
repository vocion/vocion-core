'use client';

import type { InboxItem, InboxTab } from '@/services/InboxService';
import { ArrowUpRight, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { amountLabel, confidenceLabel } from '@/services/inbox/describeActionRun';
import { agoLabel, KIND_LABEL, riskTone, waitingFor } from './inboxMeta';

/**
 * One 44px row: title and breadcrumb subline on the left; right-aligned
 * numeric columns (confidence, amount, age); Approve · Reject · Open revealed
 * on hover and on keyboard focus. Hairline dividers between rows, no card.
 *
 * Approve / Reject write through the same endpoints the review page and the
 * ask screen use, so a row can never do what the full screen could not.
 * @param props
 * @param props.item
 * @param props.tab
 */
export function InboxRow({ item, tab }: { item: InboxItem; tab: InboxTab }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decidable = tab !== 'decided' && (item.reviewId !== undefined || (item.askId !== undefined && item.kind !== 'sheet'));
  const opensHere = item.kind === 'sheet' || item.kind === 'review-sheet' || item.askId !== undefined || item.reviewId !== undefined;

  async function decide(verb: 'approve' | 'reject') {
    setBusy(verb);
    setError(null);
    try {
      const res = item.reviewId !== undefined
        ? await fetch('/api/v1/reviews/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'action', id: item.reviewId, action: verb }),
          })
        : await fetch(`/api/v1/asks/${item.askId}/decide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision: verb }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const age = tab === 'decided' ? agoLabel(item.at) : waitingFor(item.at);

  return (
    <li className="group relative flex min-h-11 items-center gap-3 px-3 transition focus-within:bg-muted/40 hover:bg-muted/40">
      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 py-2 outline-none" aria-label={item.title}>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-sm leading-5">
            <span className="truncate">{item.title}</span>
            {item.risk && (
              <span className={`hidden shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase sm:inline ${riskTone(item.risk)}`}>{item.risk}</span>
            )}
          </span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {item.subline ?? KIND_LABEL[item.kind] ?? item.kind}
            {item.kind === 'sheet' && item.count ? ` › ${item.count} questions` : ''}
            {tab === 'decided' && item.decision ? ` › ${item.decision}${item.decidedBy ? ` by ${item.decidedBy}` : ''}` : ''}
          </span>
        </span>
      </Link>

      {/* Numeric columns — right-aligned, fixed width so they line up down the list. */}
      <span className="hidden w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:inline" title="Confidence">
        {item.confidence !== undefined ? confidenceLabel(item.confidence ?? null) : ''}
      </span>
      <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums md:inline" title="Amount">
        {item.amount !== undefined && item.amount !== null ? amountLabel(item.amount, item.currency ?? null) : ''}
      </span>
      <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums" title={item.at.toLocaleString()}>
        {age}
      </span>

      {/* Row actions: visible on hover, on focus-within (keyboard), and always on touch screens. */}
      <span className="flex shrink-0 items-center justify-end gap-0.5 opacity-100 transition md:w-[76px] md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
        {decidable && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide('approve')}
              aria-label={`Approve: ${item.title}`}
              title="Approve"
              className="inline-flex size-8 items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-500/10 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:text-emerald-400"
            >
              {busy === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide('reject')}
              aria-label={`Reject: ${item.title}`}
              title="Reject"
              className="inline-flex size-8 items-center justify-center rounded-md text-red-600 hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:text-red-400"
            >
              {busy === 'reject' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
            </button>
          </>
        )}
        <Link
          href={item.href}
          aria-label={`Open: ${item.title}`}
          title="Open"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {opensHere ? <ChevronRight className="size-4" aria-hidden /> : <ArrowUpRight className="size-3.5" aria-hidden />}
        </Link>
      </span>

      {error && (
        <span role="alert" className="absolute inset-x-3 -bottom-1 truncate text-[11px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </li>
  );
}
