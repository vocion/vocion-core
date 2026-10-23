'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { AlarmClock, Check, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { openAgentSurface } from '@/features/dashboard/chat/agentSurface';
import { useRouter } from '@/libs/I18nNavigation';
import { CANDIDATE, finishedLabel, isFinishedStatus, isOwedStatus } from '@/libs/objects/rowLifecycle';
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
 * @param props.look - `bar` under a preview's title or a record page's; `inline` on a chat microcard (Done only, on hover).
 * @param props.decideRunId - For a candidate, the pending Review item that proposed it: Approve and
 * Dismiss decide it here (Chris, 2026-10-23, on a candidate's page: "how do I act from this?").
 * @param props.className - Where the bar sits: the preview's edge-to-edge row by default.
 * @param props.snoozedUntil - The date it is put off to, while that is still ahead.
 */
export function RecordLifecycle({ record, objectType, status, look = 'bar', decideRunId, className, snoozedUntil }: { record: RecordRef; objectType: string; status: string; look?: 'bar' | 'inline'; decideRunId?: number; className?: string; snoozedUntil?: string }) {
  const router = useRouter();
  const [now, setNow] = useState(status);
  const [until, setUntil] = useState<string | null>(snoozedUntil ?? null);
  const [phase, setPhase] = useState<{ s: 'idle' } | { s: 'working' } | { s: 'moved'; runId: number; from: string; untilFrom: string | null; said: string } | { s: 'error'; message: string }>({ s: 'idle' });
  const finished = isFinishedStatus(now);
  // A record in any other state (a candidate waiting in Review, a rejected
  // one) is not owed and not finished: it carries no verbs here.
  const owed = isOwedStatus(now);

  // One write for every verb that only moves the record — its status or the
  // date it is put off to — through the agent's own rail, with Undo.
  const write = async (set: { status?: string; snoozedUntil?: string | null }, why: string, said: string) => {
    const from = now;
    const untilFrom = until;
    setPhase({ s: 'working' });
    try {
      const res = await client.review.propose({
        actionId: 'objects.update_meta',
        input: { objectType, id: Number(record.id), set, reason: why },
        rationale: why,
        confidence: 0.95,
        suggestedDecision: null,
        suggestedDecisionReason: null,
      }) as { runId: number; status: string };
      if (res.status !== 'done') {
        await client.review.decideAction({ id: res.runId, decision: 'approve' });
      }
      if (set.status) {
        setNow(set.status);
      }
      if ('snoozedUntil' in set) {
        setUntil(set.snoozedUntil ?? null);
      }
      setPhase({ s: 'moved', runId: res.runId, from, untilFrom, said });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const move = (to: string) => write(
    { status: to },
    isFinishedStatus(to) ? `${finishedLabel(to)} from the record, by a person.` : 'Reopened from the record, by a person.',
    isFinishedStatus(to) ? `${finishedLabel(to)}.` : 'Reopened.',
  );

  const snooze = (to: Date | null) => write(
    { snoozedUntil: to ? to.toISOString() : null },
    to ? `Snoozed to ${to.toISOString().slice(0, 10)} from the record, by a person.` : 'Woken from the record, by a person.',
    to ? `Snoozed until ${dayLabel(to)}.` : 'Back on the list.',
  );

  // A candidate's one pending decision, made where the record is read: the
  // same decision its Review item makes. Approved, it is a thing owed and its
  // verbs follow; dismissed, it is the record of what was proposed.
  const decide = async (decision: 'approve' | 'reject') => {
    if (!decideRunId) {
      return;
    }
    setPhase({ s: 'working' });
    try {
      await client.review.decideAction({ id: decideRunId, decision, ...(decision === 'reject' ? { reason: 'Dismissed from the record.' } : {}) });
      setNow(decision === 'approve' ? 'approved' : 'rejected');
      setPhase({ s: 'idle' });
    } catch (err) {
      setPhase({ s: 'error', message: (err as Error).message });
    }
  };

  const undo = async (runId: number, from: string, untilFrom: string | null = until) => {
    setPhase({ s: 'working' });
    try {
      await client.review.undoAction({ id: runId });
      setNow(from);
      setUntil(untilFrom);
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

  const bar = className ?? 'border-b border-border/60 px-4 py-2';
  const proposal = now === CANDIDATE && Boolean(decideRunId);
  if (proposal && look === 'bar') {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${bar}`} data-testid="record-lifecycle" data-status={now}>
        <span className="mr-1 text-[13px] text-muted-foreground">Proposed. Keep it?</span>
        <button type="button" onClick={() => void decide('approve')} disabled={working} data-testid="record-lifecycle-approve" className={buttonVariants({ size: 'sm' })}>
          {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          Approve
        </button>
        <button type="button" onClick={() => void decide('reject')} disabled={working} data-testid="record-lifecycle-dismiss" className={quiet}>
          <X className="size-3.5" aria-hidden />
          Dismiss
        </button>
        {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]" role="alert">{phase.message}</p>}
      </div>
    );
  }
  if (now === 'rejected' && look === 'bar' && decideRunId) {
    return <p className={`text-[13px] text-muted-foreground ${bar}`} data-testid="record-lifecycle-dismissed">Dismissed.</p>;
  }
  if (!owed && !finished && phase.s !== 'moved') {
    return null;
  }

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
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm', className: 'opacity-0 group-hover/microcard:opacity-100 focus-visible:opacity-100' })}
      >
        {working ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
      </button>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${bar}`} data-testid="record-lifecycle" data-status={now}>
      {phase.s === 'moved'
        ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" data-testid="record-lifecycle-moved">
              {phase.said}
              <button type="button" onClick={() => void undo(phase.runId, phase.from, phase.untilFrom)} data-testid="record-lifecycle-undo" className="inline-flex items-center gap-1 text-foreground underline underline-offset-2">
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
                {until && (
                  <span className="mr-1 flex items-center gap-1 text-[13px] text-muted-foreground" data-testid="record-lifecycle-snoozed">
                    <AlarmClock className="size-3.5" aria-hidden />
                    {`Snoozed until ${dayLabel(new Date(until))}`}
                    <button type="button" onClick={() => void snooze(null)} disabled={working} data-testid="record-lifecycle-wake" className="ml-1 text-foreground underline underline-offset-2">Wake</button>
                  </span>
                )}
                <button type="button" onClick={doIt} data-testid="record-lifecycle-do" className={buttonVariants({ size: 'sm' })}>
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
                {!until && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" disabled={working} data-testid="record-lifecycle-snooze" title="Put it off" className={quiet}>
                        <AlarmClock className="size-3.5" aria-hidden />
                        Snooze
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {snoozeChoices(new Date()).map(c => (
                        <DropdownMenuItem key={c.label} onSelect={() => void snooze(c.at)} data-testid="record-lifecycle-snooze-choice">
                          <span>{c.label}</span>
                          <span className="ml-auto pl-4 text-xs text-muted-foreground">{dayLabel(c.at)}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
      {phase.s === 'error' && <p className="w-full text-xs text-[var(--brand-fail)]" role="alert">{phase.message}</p>}
    </div>
  );
}

/**
 * When a person can put a record off to, at nine in the morning their time:
 * tomorrow, next Monday, and two weeks out.
 * @param now - The clock.
 */
export function snoozeChoices(now: Date): Array<{ label: string; at: Date }> {
  const at = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const toMonday = ((8 - now.getDay()) % 7) || 7;
  return [
    { label: 'Tomorrow', at: at(1) },
    { label: 'Next Monday', at: at(toMonday) },
    { label: 'In 2 weeks', at: at(14) },
  ];
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
