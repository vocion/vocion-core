'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { Check, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { useRouter } from '@/libs/I18nNavigation';
import { finishedLabel, isFinishedStatus } from '@/libs/objects/rowLifecycle';
import { client } from '@/libs/Orpc';

/**
 * A RECORD'S VERBS, where it is read: Do it, Done, Drop — and Reopen once it
 * is finished (2026-10-23: a follow-up previewed as its owed action and its
 * hook, with nothing to press; fifteen of them stayed open because neither a
 * person nor the agent could close one).
 *
 * Done and Drop move the row through its own lifecycle (`libs/objects/rowLifecycle`)
 * through `objects.update_meta` — the action the agent's close goes through —
 * so a person's click is a run on the record's history with Undo one move
 * away, under the workspace's trust rule, exactly like `FeatureDismiss`.
 *
 * Do it hands the record to the team in the person's own words: the agent
 * reads what the record owes and does it, holding anything that goes out for
 * approval. Core reads no field to decide what that is — the type is the
 * workspace's, and so is the meaning of its fields.
 * @param props
 * @param props.record - The record (`type: 'object'`), with its label.
 * @param props.objectType - Its type's slug.
 * @param props.status - Its row status now.
 * @param props.look - `bar` under a preview's title; `inline` on a chat microcard (Done only, on hover).
 */
export function RecordLifecycle({ record, objectType, status, look = 'bar' }: { record: RecordRef; objectType: string; status: string; look?: 'bar' | 'inline' }) {
  const router = useRouter();
  const [now, setNow] = useState(status);
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'moved'; runId: number; from: string } | { s: 'error'; message: string }>({ s: 'idle' });
  const finished = isFinishedStatus(now);

  const move = async (to: string) => {
    const from = now;
    setPhase({ s: 'working' });
    try {
      const why = `${finishedLabel(to)} from the record, by a person.`;
      const res = await client.review.propose({
        actionId: 'objects.update_meta',
        input: { objectType, id: Number(record.id), set: { status: to }, reason: isFinishedStatus(to) ? why : 'Reopened from the record, by a person.' },
        rationale: why,
        confidence: 0.95,
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      if (res.status !== 'done') {
        await client.review.decideAction({ id: res.runId, decision: 'approve' });
      }
      setNow(to);
      setPhase({ s: 'moved', runId: res.runId, from });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const undo = async (runId: number, from: string) => {
    setPhase({ s: 'working' });
    try {
      await client.review.undoAction({ id: runId });
      setNow(from);
      setPhase({ s: 'idle' });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const doIt = () => {
    openAgentSurface({
      prompt: `Do what "${record.label ?? 'this record'}" owes. Hold anything that goes out to someone for my approval.`,
      send: true,
      context: { path: window.location.pathname, title: document.title, record },
    }, href => router.push(href));
  };

  const working = phase.s === 'working';
  const quiet = 'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-60';

  if (look === 'inline') {
    if (phase.s === 'moved') {
      return (
        <button type="button" onClick={() => void undo(phase.runId, phase.from)} data-testid="record-lifecycle-undo" className="inline-flex shrink-0 items-center gap-1 px-1 text-[12px] text-muted-foreground hover:text-foreground">
          {`${finishedLabel(now)} ·`}
          <RotateCcw className="size-3" aria-hidden />
          Undo
        </button>
      );
    }
    if (finished) {
      return <span className="shrink-0 px-1 text-[12px] text-muted-foreground" data-testid="record-lifecycle-state">{finishedLabel(now)}</span>;
    }
    return (
      <button
        type="button"
        onClick={() => void move('done')}
        disabled={working}
        aria-label={`Mark ${record.label ?? 'this record'} done`}
        title={phase.s === 'error' ? phase.message : 'Done'}
        data-testid="record-lifecycle-done"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover/microcard:opacity-100 hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100"
      >
        {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-2" data-testid="record-lifecycle" data-status={now}>
      {phase.s === 'moved'
        ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="record-lifecycle-moved">
              {isFinishedStatus(now) ? `${finishedLabel(now)}.` : 'Reopened.'}
              <button type="button" onClick={() => void undo(phase.runId, phase.from)} data-testid="record-lifecycle-undo" className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
                <RotateCcw className="size-3.5" aria-hidden />
                Undo
              </button>
            </p>
          )
        : finished
          ? (
              <>
                <span className="text-[13px] text-muted-foreground" data-testid="record-lifecycle-state">{finishedLabel(now)}</span>
                <button type="button" onClick={() => void move('open')} disabled={working} data-testid="record-lifecycle-reopen" className={quiet}>Reopen</button>
              </>
            )
          : (
              <>
                <button type="button" onClick={doIt} data-testid="record-lifecycle-do" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-foreground px-3 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90">
                  <Sparkles className="size-3.5" aria-hidden />
                  Do it
                </button>
                <button type="button" onClick={() => void move('done')} disabled={working} data-testid="record-lifecycle-done" className={quiet}>
                  {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                  Done
                </button>
                <button type="button" onClick={() => void move('dropped')} disabled={working} data-testid="record-lifecycle-drop" title="Not doing this" className={quiet}>
                  <X className="size-3.5" aria-hidden />
                  Drop
                </button>
              </>
            )}
      {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]" role="alert">{phase.message}</p>}
    </div>
  );
}
