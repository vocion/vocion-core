'use client';

import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { StickyActionBar } from '@/features/dashboard/StickyActionBar';
import { ReviewHeader } from '@/features/review/ReviewHeader';
import { shortcutFor } from '@/features/review/reviewShortcuts';
import { Link } from '@/libs/I18nNavigation';
import { DECISION_VERBS, verbForShortcut } from './decisionVerbs';
import { decisionCrumbs } from './inboxMeta';
import { withMinimumPending } from './pending';

/** One rule candidate, as the server page hands it over. */
export type LearningCandidateView = {
  id: number;
  stepName: string;
  ruleText: string;
  editedRuleText: string | null;
  /** 'correct' = change this behaviour, 'reinforce' = keep doing it. */
  polarity: string;
  occurrenceCount: number;
  sourceFeedbackJobId: number | null;
  status: string;
  rejectedReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

const INLINE_FIELD = 'w-full rounded-md bg-transparent px-2 py-1.5 text-sm transition outline-none hover:bg-[var(--surface-hover,var(--muted))] focus:bg-[var(--surface-soft,var(--muted))]';

/**
 * The `learning` kind's decision screen: one suggested rule, editable in
 * place, with Adopt / Reject in the sticky bar and the reason for a rejection
 * in the bar's field. Talks to the same endpoints the Learnings page and an
 * external admin panel use — `PATCH /api/v1/learning-candidates/:id` to
 * reword, `POST …/decide` to decide — so the rule adopted here is the rule
 * adopted anywhere. A rejection needs a reason: the reason is the record of
 * why the classifier was wrong, and is worth more than the rejection itself.
 * @param props
 * @param props.candidate
 */
export function LearningDecision({ candidate }: { candidate: LearningCandidateView }) {
  const t = useTranslations('Review');
  const router = useRouter();
  const current = candidate.editedRuleText ?? candidate.ruleText;
  const [draft, setDraft] = useState(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const verbs = DECISION_VERBS.learning;
  const open = candidate.status === 'pending';

  // `a` adopts, `d` rejects — the same keys the bar shows. Never while typing.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, target: e.target as HTMLElement | null });
      const verb = action ? verbForShortcut('learning', action) : null;
      if (!verb || busy) {
        return;
      }
      e.preventDefault();
      void decide(verb.id === 'approve' ? 'approve' : 'reject');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function messageFor(res: Response): Promise<string> {
    const body = await res.json().catch(() => null);
    return body?.error?.message ?? `${res.status} ${res.statusText}`;
  }

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) {
      setError('Say why this is not a rule worth keeping — the reason is what the team learns from.');
      return;
    }
    setBusy(decision);
    setError(null);
    try {
      await withMinimumPending((async () => {
        if (draft.trim() && draft !== current) {
          const patched = await fetch(`/api/v1/learning-candidates/${candidate.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ editedRuleText: draft }),
          });
          if (!patched.ok) {
            throw new Error(await messageFor(patched));
          }
        }
        const res = await fetch(`/api/v1/learning-candidates/${candidate.id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: decision, reason: decision === 'reject' ? reason.trim() : undefined }),
        });
        if (!res.ok) {
          throw new Error(await messageFor(res));
        }
      })());
      toast.success(`${decision === 'approve' ? 'Adopted' : 'Rejected'} · ${draft.trim().slice(0, 80)}`, {
        description: decision === 'approve' ? `Agents read it at /learnings/${candidate.stepName}.md on their next run.` : 'Dropped; your reason is kept for the classifier.',
      });
      // Stay on the rule. The page re-reads it and renders what was decided,
      // with an explicit way back — a redirect on submit loses the context
      // the decision was made in (Chris, 2026-09-16).
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(`Could not ${decision === 'approve' ? 'adopt' : 'reject'} the rule`, { description: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl" data-testid="learning-decision">
      <ReviewHeader
        crumbs={decisionCrumbs('learning', candidate.stepName)}
        title={current}
        system="Suggested rule"
        status={candidate.status === 'approved' ? 'approved' : candidate.status}
        proposedBy={`from feedback${candidate.sourceFeedbackJobId !== null ? ` #${candidate.sourceFeedbackJobId}` : ''}`}
      />

      <section className="border-b border-rule py-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span>
            Step
            {' '}
            <Link href={`/dashboard/learnings/${encodeURIComponent(candidate.stepName)}`} className="font-mono text-foreground/80 underline decoration-border underline-offset-2 hover:decoration-foreground">{candidate.stepName}</Link>
          </span>
          <span aria-hidden className="text-muted-foreground/50">·</span>
          <span
            className={candidate.polarity === 'reinforce' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}
            title={candidate.polarity === 'reinforce'
              ? 'Someone praised this and said why — adopting it tells the agent to keep doing it'
              : 'Someone disagreed and said why — adopting it tells the agent to do this differently'}
          >
            {candidate.polarity === 'reinforce' ? 'keep doing' : 'change'}
          </span>
          {candidate.occurrenceCount > 1 && (
            <>
              <span aria-hidden className="text-muted-foreground/50">·</span>
              <span title="How many separate pieces of feedback asked for this same rule">{`asked ${candidate.occurrenceCount} times`}</span>
            </>
          )}
        </div>
      </section>

      <section className="border-b border-rule py-6">
        <div className="mb-2 text-[11px] font-medium text-muted-foreground">{open ? 'The rule — edit in place; your wording is what the agent reads' : 'The rule'}</div>
        {open
          ? <textarea className={`${INLINE_FIELD} min-h-24 resize-y leading-relaxed`} value={draft} onChange={e => setDraft(e.target.value)} disabled={busy !== null} aria-label="Rule text" />
          : <p className="text-[15px] leading-relaxed">{current}</p>}
        {!open && (
          <p className="mt-3 text-[13px] text-muted-foreground">
            {candidate.status === 'approved' ? 'Adopted' : 'Rejected'}
            {candidate.decidedBy ? ` by ${candidate.decidedBy}` : ''}
            {candidate.decidedAt ? ` · ${new Date(candidate.decidedAt).toLocaleString()}` : ''}
            {candidate.rejectedReason ? ` — “${candidate.rejectedReason}”` : ''}
          </p>
        )}
        {!open && (
          <p className="mt-3">
            <Link href="/dashboard/inbox?kind=learning" className="text-[13px] text-primary underline-offset-2 hover:underline" data-testid="learning-back">Back to the review queue</Link>
          </p>
        )}
      </section>

      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</div>
      )}

      {open && (
        <StickyActionBar
          labels={{ addField: t('add_feedback'), hideField: t('hide_feedback') }}
          primary={{ 'label': verbs.primary.label, 'onClick': () => void decide('approve'), 'disabled': busy !== null || !draft.trim(), 'busy': busy === 'approve', 'icon': Check, 'shortcut': verbs.primary.shortcut, 'data-testid': 'learning-adopt' }}
          secondary={verbs.secondary.map(v => ({ 'label': v.label, 'onClick': () => void decide('reject'), 'disabled': busy !== null, 'busy': busy === 'reject', 'icon': X, 'shortcut': v.shortcut, 'tone': v.tone, 'data-testid': 'learning-reject' }))}
          field={{
            label: 'Why reject',
            placeholder: 'Why is this not a rule worth keeping? Required to reject.',
            value: reason,
            onChange: setReason,
            disabled: busy !== null,
            hint: 'A rejection needs a reason; it is what the classifier learns from.',
          }}
        />
      )}
    </div>
  );
}
