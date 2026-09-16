'use client';

import type { DecisionVerb } from './decisionVerbs';
import type { InboxItem, InboxTab } from '@/services/InboxService';
import { ArrowUpRight, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from '@/components/ui/toast';
import { Link } from '@/libs/I18nNavigation';
import { amountLabel, confidenceLabel } from '@/services/inbox/describeActionRun';
import { rowVerbs } from './decisionVerbs';
import { agoLabel, INBOX_KIND_META, riskTone, waitingFor } from './inboxMeta';
import { withMinimumPending } from './pending';

/**
 * One 44px row: title and breadcrumb subline (kind first) on the left;
 * right-aligned numeric columns (confidence, amount, age); the kind's quick
 * verbs · Open revealed on hover and on keyboard focus. Hairline dividers
 * between rows, no card.
 *
 * The quick verbs come from `DECISION_VERBS`, the same table the detail
 * screen's sticky bar reads, and write through the same endpoints, so a row
 * can never do what the full screen could not.
 * @param props
 * @param props.item
 * @param props.tab
 */
export function InboxRow({ item, tab }: { item: InboxItem; tab: InboxTab }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verbs = tab === 'decided' || !canQuickDecide(item) ? [] : rowVerbs(item.kind, item.shape);
  const opensHere = item.href.startsWith('/dashboard/inbox');
  const meta = INBOX_KIND_META[item.kind];
  const KindIcon = meta.icon;

  async function decide(verb: DecisionVerb) {
    setBusy(verb.id);
    setError(null);
    try {
      const res = await withMinimumPending(postDecision(item, verb));
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
      }
      toast.success(`${verb.label} · ${item.title}`, { description: nextFor(item, verb) });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Could not ${verb.label.toLowerCase()} “${item.title}”`, { description: message });
    } finally {
      setBusy(null);
    }
  }

  const age = tab === 'decided' ? agoLabel(item.at) : waitingFor(item.at);

  return (
    <li className="group relative flex min-h-11 items-center gap-3 px-3 transition focus-within:bg-muted/40 hover:bg-muted/40" data-kind={item.kind}>
      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 py-2 outline-none" aria-label={item.title}>
        <span title={meta.label} className="inline-flex shrink-0"><KindIcon className="size-3.5 text-muted-foreground/70" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2 text-sm leading-5">
            <span className="truncate">{item.title}</span>
            {item.risk && (
              <span className={`hidden shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase sm:inline ${riskTone(item.risk)}`}>{item.risk}</span>
            )}
          </span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {[item.shape === 'sheet' && item.kind !== 'proposal' ? 'Decision sheet' : meta.label, item.subline].filter(Boolean).join(' › ')}
            {tab === 'decided' && item.decision ? ` › ${item.decision}${item.decidedBy ? ` by ${item.decidedBy}` : ''}${item.note ? ` — “${item.note}”` : ''}` : ''}
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
        {verbs.map(verb => (
          <button
            key={verb.id}
            type="button"
            disabled={busy !== null}
            onClick={() => decide(verb)}
            aria-label={`${verb.label}: ${item.title}`}
            title={verb.label}
            className={`inline-flex size-8 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 ${
              verb.tone === 'danger' ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400' : 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400'
            }`}
          >
            {busy === verb.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : verb.tone === 'danger' ? <X className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
          </button>
        ))}
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

/**
 * What happens next, for the toast — the header no longer carries "what changed".
 * @param item - The row.
 * @param verb - The verb taken.
 */
function nextFor(item: InboxItem, verb: DecisionVerb): string {
  if (item.kind === 'proposal') {
    return verb.id === 'approve' ? 'Executing now.' : 'Nothing runs; the agent learns from it.';
  }
  if (item.kind === 'learning') {
    return verb.id === 'approve' ? 'The agent reads the rule on its next run.' : 'Dropped; the reason is kept for the classifier.';
  }
  return 'The team reads your answer on its next cycle.';
}

/**
 * A row can decide in place when it carries the id its endpoint needs.
 * @param item - The row.
 */
function canQuickDecide(item: InboxItem): boolean {
  return item.reviewId !== undefined || item.askId !== undefined || (item.kind === 'learning' && item.ref !== undefined);
}

/**
 * The same endpoints the detail screens use — the review decide route for a
 * proposal, the ask decide route for an ask, the learning-candidate decide
 * route for a suggested rule. A rejected rule needs a reason; the row sends
 * the one thing it knows.
 * @param item
 * @param verb
 */
function postDecision(item: InboxItem, verb: DecisionVerb): Promise<Response> {
  const json = { 'Content-Type': 'application/json' };
  if (item.reviewId !== undefined) {
    return fetch('/api/v1/reviews/decide', { method: 'POST', headers: json, body: JSON.stringify({ kind: 'action', id: item.reviewId, action: verb.id === 'approve' ? 'approve' : 'reject' }) });
  }
  if (item.askId !== undefined) {
    return fetch(`/api/v1/asks/${item.askId}/decide`, { method: 'POST', headers: json, body: JSON.stringify({ decision: verb.id === 'approve' ? 'approve' : 'reject' }) });
  }
  return fetch(`/api/v1/learning-candidates/${item.ref!.id}/decide`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify(verb.id === 'approve' ? { action: 'approve' } : { action: 'reject', reason: 'Rejected from the Needs-you list' }),
  });
}
