'use client';

import type { ReportState } from '@/services/factory/featureReport';
import { Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RecommendedActionCard } from '@/features/dashboard/chat/RecommendedActionCard';
import { Link } from '@/libs/I18nNavigation';

/**
 * THE DECISION, DECIDABLE HERE.
 *
 * The feature page used to open on a box that asked a question and offered
 * a button to go somewhere else ("Review decision"). Chris, 2026-09-24: the
 * decision isn't decidable here; the facts contradict; the picture is below
 * the fold. This card is the same decision card the chat draws — what is
 * asked, what is recommended and why, the risk, the cost, and Approve /
 * Reject / Defer — so the page and the chat are one shape (principle 6).
 *
 * A proposal (an action run awaiting a person) IS the chat card, with its
 * live status. An ask (a question filed for a person) is decided through the
 * asks API the inbox uses; it has no snooze today, so Defer is a link to the
 * inbox rather than a promise this card cannot keep.
 * @param props
 * @param props.state - The derived state, with its open decision.
 */
export function DecisionCard({ state }: { state: ReportState }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [done, setDone] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = state.decision;
  if (!d) {
    return null;
  }
  const facts = [d.recommendation, d.risk ? `Risk: ${d.risk}` : null, d.cost ? `Cost: ${d.cost}` : null].filter((x): x is string => !!x);

  if (d.kind === 'proposal' && d.actionId) {
    return (
      <section id="report-state" data-testid="report-decision" className="rounded-lg border border-brand-amber/50 bg-brand-amber-tint p-3">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-brand-amber-deep uppercase">
          {state.label}
          <span className="ml-2 font-normal tracking-normal text-muted-foreground normal-case">{state.detail}</span>
        </p>
        <RecommendedActionCard rec={{ actionId: d.actionId, input: {}, label: state.question ?? state.label, rationale: facts.join(' · ') || undefined, runId: d.id, agentSlug: 'product-manager' }} />
      </section>
    );
  }

  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch(`/api/v1/asks/${d.id}/decide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
      if (!res.ok) {
        throw new Error(`the server said ${res.status}`);
      }
      setDone(decision);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="report-state" data-testid="report-decision" className="rounded-lg border border-brand-amber/50 bg-brand-amber-tint p-3">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-brand-amber-deep uppercase">
        {state.label}
        <span className="ml-2 font-normal tracking-normal text-muted-foreground normal-case">{done ? (done === 'approve' ? 'approved · just now' : 'rejected · just now') : state.detail}</span>
      </p>
      {state.question && <p className="mt-1.5 text-[15px] font-medium break-words text-foreground">{state.question}</p>}
      {facts.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm text-muted-foreground">
          {facts.map(f => <li key={f} className="break-words">{f}</li>)}
        </ul>
      )}
      {done === null && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void decide('approve')} disabled={busy !== null} data-testid="report-approve" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-amber px-3 text-[13px] font-medium text-white transition-colors hover:bg-brand-amber-deep disabled:opacity-60">
            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            Approve
          </button>
          <button type="button" onClick={() => void decide('reject')} disabled={busy !== null} data-testid="report-reject" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-60">
            {busy === 'reject' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
            Reject
          </button>
          <Link href="/dashboard/inbox?kind=ask" className="text-[13px] text-muted-foreground underline-offset-2 hover:underline">Not now</Link>
          {error && (
            <span className="text-xs text-destructive">
              Couldn’t decide it:
              {error}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
