'use client';

import type { DecisionVerb } from './decisionVerbs';
import type { InboxItem, InboxTab } from '@/services/InboxService';
import { ArrowUpRight, Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Column, ListRow, Subline } from '@/components/patterns';
import { ConfidenceBars } from '@/components/ui/confidence-indicator';
import { toast } from '@/components/ui/toast';
import { Link } from '@/libs/I18nNavigation';
import { amountLabel } from '@/services/inbox/describeActionRun';
import { rowVerbs } from './decisionVerbs';
import { agoLabel, INBOX_KIND_META, riskTone, waitingFor } from './inboxMeta';
import { withMinimumPending } from './pending';

/**
 * One row of the Needs-you queue, rendered through `patterns/ListRow` — the
 * same component the Search, Artifacts, Personalization and Learnings lists
 * use. Title and breadcrumb subline (kind first) on the left; right-aligned
 * numeric columns (confidence, amount, age) at the shared `COLUMN` widths;
 * the kind's quick verbs · Open revealed on hover and on keyboard focus.
 *
 * The quick verbs come from `DECISION_VERBS`, the same table the detail
 * screen's sticky bar reads, and write through the same endpoints, so a row
 * can never do what the full screen could not.
 * @param props
 * @param props.item
 * @param props.tab
 * @param props.why - One clause saying why this matters NOW, rendered under
 * the breadcrumb. The briefing's "Needs your decision" cards are these rows
 * with their why-now attached (docs/specs/briefing-v2.md §2) — the same
 * decision, the same row, the same place it goes.
 */
export function InboxRow({ item, tab, why }: { item: InboxItem; tab: InboxTab; why?: string }) {
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
    <div className="relative" data-kind={item.kind}>
      <ListRow
        href={item.href}
        icon={KindIcon}
        title={(
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-normal">{item.title}</span>
            {item.risk && (
              <span className={`hidden shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wide uppercase sm:inline ${riskTone(item.risk)}`}>{item.risk}</span>
            )}
          </span>
        )}
        subline={(
          <>
            <Subline
              separator="›"
              segments={[
                item.shape === 'sheet' && item.kind !== 'proposal' ? 'Decision sheet' : meta.label,
                item.subline,
                tab === 'decided' && item.decision
                  ? `${item.decision}${item.decidedBy ? ` by ${item.decidedBy}` : ''}${item.note ? ` — “${item.note}”` : ''}`
                  : null,
              ]}
            />
            {why && <span className="mt-0.5 block text-[13px] leading-5 text-foreground/80">{why}</span>}
          </>
        )}
        columns={(
          <>
            <Column kind="score" className="hidden sm:inline-block">
              {/* Was a bare `85%`. One renderer, and the class the number is
                  about travels with it (MANIFESTO §19 + §12). */}
              {item.confidence !== undefined && item.confidence !== null
                ? <ConfidenceBars value={item.confidence} subject="Recommendation" />
                : null}
            </Column>
            <Column kind="amount" className="hidden sm:inline-block">
              <span title="Amount">{item.amount !== undefined && item.amount !== null ? amountLabel(item.amount, item.currency ?? null) : ''}</span>
            </Column>
            <Column kind="number" always>
              <span title={item.at.toLocaleString()}>{age}</span>
            </Column>
          </>
        )}
        chevron={false}
        actions={(
          // A fixed width so the numeric columns land in the same place on
          // every row and under the list's own header labels.
          <span className="flex w-[76px] items-center justify-end gap-0.5">
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
        )}
      />

      {error && (
        <span role="alert" className="absolute inset-x-3 -bottom-1 truncate text-[11px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
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
