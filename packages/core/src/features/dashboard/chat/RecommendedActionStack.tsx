'use client';

import type { RecommendedAction } from './types';
import { ArrowRight, Bookmark, Check, Layers, Loader2, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { RECOMMENDED_ACTION_ADVICE } from '@/services/chat/autoPropose';
import { RecommendedActionCard } from './RecommendedActionCard';

/**
 * Multi-card triage IN CHAT — when a turn surfaces several recommended
 * actions, show them as an ephemeral stepper (the Slack-catch-up pattern)
 * instead of a wall of cards: one card at a time with Skip / Save-for-later,
 * plus "Queue all" bulk. Save + Queue-all JIT-propose to the review queue
 * (same gated review.propose path as the card CTA — nothing sends); Skip is
 * ephemeral. Finishing shows a tally + queue link.
 */

type Outcome = 'saved' | 'skipped' | 'acted';

export function RecommendedActionStack({ recs, autoPropose = false }: { recs: RecommendedAction[]; autoPropose?: boolean }) {
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [bulkDone, setBulkDone] = useState(false);

  if (recs.length <= 1 || autoPropose) {
    // At `act-within-bounds` every recommendation proposes itself, so the
    // one-at-a-time triage has nothing to triage — show the cards as a list.
    return <>{recs.map((rec, i) => <RecommendedActionCard key={i} rec={rec} autoPropose={autoPropose} />)}</>;
  }
  // Everything the server already filed (act-within-bounds) is a card with a
  // live status, not a stepper item — show those first, step through the rest.
  const filed = recs.filter(r => r.runId !== undefined);
  const open = recs.filter(r => r.runId === undefined);
  if (open.length <= 1 && filed.length > 0) {
    return <>{recs.map((rec, i) => <RecommendedActionCard key={i} rec={rec} />)}</>;
  }

  const propose = async (rec: RecommendedAction): Promise<void> => {
    // Same refusal as the card's: a recommendation with no action id cannot
    // produce a valid proposal, and "Queue all" must not turn one bad payload
    // into a burst of 400s.
    if (!rec.actionId) {
      throw new Error('This recommendation named no action, so there is nothing to prepare.');
    }
    await client.review.propose({
      actionId: rec.actionId,
      input: rec.input,
      agentSlug: rec.agentSlug,
      rationale: rec.rationale,
      confidence: rec.confidence,
      ...RECOMMENDED_ACTION_ADVICE,
    });
  };

  const advance = (o: Outcome) => {
    setOutcomes(prev => [...prev, o]);
    setIdx(i => i + 1);
  };

  const onSave = async () => {
    const rec = recs[idx];
    if (!rec) {
      return;
    }
    setBusy(true);
    try {
      await propose(rec);
      advance('saved');
    } catch {
      advance('skipped');
    } finally {
      setBusy(false);
    }
  };

  const onQueueAll = async () => {
    setBusy(true);
    try {
      // Upsert-by-key on the server dedupes anything already proposed.
      for (const rec of recs.slice(idx)) {
        await propose(rec).catch(() => {});
      }
      setBulkDone(true);
    } finally {
      setBusy(false);
    }
  };

  const done = bulkDone || idx >= recs.length;
  const saved = outcomes.filter(o => o === 'saved').length + (bulkDone ? recs.length - idx : 0);

  if (done) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm">
        <Check className="size-4 text-brand-amber-deep" aria-hidden />
        <span className="text-foreground/85">
          {saved > 0 ? `${saved} saved to your queue` : 'All set'}
          {outcomes.filter(o => o === 'skipped').length > 0 && ` · ${outcomes.filter(o => o === 'skipped').length} skipped`}
        </span>
        {saved > 0 && (
          <Link href="/dashboard/inbox?kind=proposal" className="inline-flex items-center gap-1 font-medium text-brand-amber-deep hover:opacity-90">
            Needs you
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    );
  }

  const current = recs[idx]!;
  return (
    <div className="mt-3" data-testid="recommended-action-stack">
      <div className="flex items-center justify-between px-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          <Layers className="size-3.5" aria-hidden />
          Suggested actions
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {idx + 1}
          {' of '}
          {recs.length}
        </span>
      </div>

      <RecommendedActionCard key={idx} rec={current} />

      <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          onClick={() => advance('skipped')}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <SkipForward className="size-3.5" aria-hidden />
          Skip
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Bookmark className="size-3.5" aria-hidden />}
          Save for later
        </button>
        <button
          type="button"
          onClick={() => void onQueueAll()}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-brand-amber-deep transition hover:opacity-90 disabled:opacity-50"
        >
          Queue all
          {' '}
          {recs.length - idx}
          {' '}
          for review
          <ArrowRight className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
