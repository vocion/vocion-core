'use client';

import type { useGuidedReview } from './GuidedReview';
import type { ReviewCardRun } from '@/features/review/ReviewActionCard';
import { useState } from 'react';
import { GuidedCard, GuidedList } from './GuidedReview';

/**
 * The guided review as it appears in the dock: the sequence overview, a card
 * per send, then the decision. The reviewer is dropped straight into send 1
 * — there is no "start" to press, because they came here to review.
 */

export type GuidedReviewPanelProps = {
  run: ReviewCardRun;
  onDecided?: (outcome: 'approve' | 'reject' | 'snooze') => void;
  /** Set by the dock when the composer's ask was a revision. */
  guided: ReturnType<typeof useGuidedReview>;
};

const btn = 'rounded-lg px-2.5 py-1 text-xs font-semibold transition';
const primary = `${btn} bg-brand-amber text-white hover:bg-brand-amber-deep disabled:bg-muted disabled:text-muted-foreground/60`;
const quiet = `${btn} border border-border text-foreground/80 hover:bg-muted`;

export function GuidedReviewPanel({ run, guided }: GuidedReviewPanelProps) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const { sends, state, outcome, current, revisions } = guided;

  if (sends.length === 0) {
    return null;
  }

  const heading = run.card.recommendation?.headline ?? run.card.title;

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <GuidedCard eyebrow="Sequence overview" title={heading}>
        <GuidedList items={sends.map(s => (
          <span key={s.id}>
            <b>{s.label}</b>
            {' · '}
            {s.subject}
          </span>
        ))}
        />
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Ask for changes here, or select a line in the brief.
        </p>
      </GuidedCard>

      {/* The send under review. A revised send comes back marked, because the
          approval binds to the copy on screen. */}
      {current && (
        <GuidedCard
          eyebrow={`Send ${current.position} of ${sends.length} · ${current.label}${guided.versionOf(current) > 1 ? ` · v${guided.versionOf(current)} · revised` : ''}`}
          title={current.subject}
          actions={(
            <button
              type="button"
              className={primary}
              disabled={guided.busy}
              onClick={() => {
                guided.reread(current.id);
                guided.advance();
              }}
            >
              {current.position === sends.length ? 'Looks good · finish' : `Looks good · send ${current.position + 1} next`}
            </button>
          )}
        >
          <p className="mt-1.5 whitespace-pre-line text-foreground/85">{guided.bodyOf(current)}</p>
        </GuidedCard>
      )}

      {/* Revised sends the reviewer has not come back to. The decision waits
          on these rather than letting an unseen change ride along. */}
      {state.unread.map((id) => {
        const send = sends.find(s => s.id === id);
        if (!send || send.id === current?.id) {
          return null;
        }
        return (
          <GuidedCard
            key={id}
            eyebrow={`Send ${send.position} · v${guided.versionOf(send)} · revised`}
            title={send.subject}
            actions={<button type="button" className={primary} onClick={() => guided.reread(id)}>Looks good</button>}
          >
            <p className="mt-1.5 whitespace-pre-line text-foreground/85">{guided.bodyOf(send)}</p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Revised on your instruction. The approval binds to this copy.
            </p>
          </GuidedCard>
        );
      })}

      {guided.canDecide && !declining && (
        <GuidedCard
          eyebrow="Ready to decide"
          title={`All ${sends.length} sends reviewed`}
          actions={(
            <>
              <button type="button" className={primary} disabled={guided.busy} onClick={() => void guided.decide('approve')}>
                {run.card.verbs?.approve ?? 'Approve'}
              </button>
              <button type="button" className={quiet} disabled={guided.busy} onClick={() => void guided.decide('snooze')}>Snooze</button>
              <button type="button" className={quiet} disabled={guided.busy} onClick={() => setDeclining(true)}>
                {run.card.verbs?.reject ?? 'Decline'}
              </button>
            </>
          )}
        >
          <GuidedList items={[
            revisions.length > 0
              ? `${revisions.length} revision${revisions.length > 1 ? 's' : ''} applied: ${revisions.map(r => `send ${sends.find(s => s.id === r.contentId)?.position} (“${r.ask}”)`).join(', ')}`
              : 'No changes asked for',
            ...(revisions.length > 0 ? ['The copy shown above is what sends'] : []),
            'Approving enrolls this lead in the recommended sequence',
          ]}
          />
        </GuidedCard>
      )}

      {/* Prod's rule, in the flow: a decline teaches nothing without a reason. */}
      {declining && (
        <GuidedCard eyebrow="Decline · a note is required">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="What should the agent learn from this decline?"
            rows={2}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-amber"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={!note.trim() || guided.busy}
              onClick={() => void guided.decide('reject', note.trim())}
            >
              Decline with the note
            </button>
            <button type="button" className={quiet} onClick={() => setDeclining(false)}>Back</button>
          </div>
        </GuidedCard>
      )}

      {outcome && (
        <GuidedCard eyebrow="Agent" title={outcome.decision}>
          <p className="mt-1.5 text-foreground/85">{outcome.detail}</p>
        </GuidedCard>
      )}
    </div>
  );
}
