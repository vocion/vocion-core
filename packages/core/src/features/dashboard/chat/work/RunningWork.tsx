'use client';

import type { WorkItem, WorkView } from '@/services/work/WorkService';
import { ChevronDown, ChevronRight, Loader2, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/buttonVariants';
import { openPreview } from '@/features/preview/previewState';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';
import { workPreviewRef } from '@/libs/preview/workRef';
import { formatElapsed } from '../useElapsed';

/**
 * "N RUNNING ›" — the long and background work behind a conversation, in one
 * quiet chip in the thread (founder, 2026-10-09, after Claude Code's "1
 * background task stopped, 1 running ›": "it hides complexity so well, while
 * allowing click to explorability").
 *
 * The chip names what runs, in the runs' own words ({@link runningLine}),
 * then says how many are running and how many finished since the
 * conversation began; tapping it opens the work in the right column's one
 * preview pane (`?preview=conversation:<id>.work`, `libs/preview/workRef.ts`),
 * on top of whatever that pane already showed — a full-screen sheet on a
 * phone, as every preview is. It lists what runs now (Stop where the run has
 * one) and a folded "Finished N", each linking to its run. Read from the run
 * records the platform already keeps (`services/work/WorkService.ts`); polled
 * while anything runs, and again when a turn lands.
 *
 * It had its own sheet until 2026-10-23, which opened a second side surface
 * beside the preview pane (Chris: "a new sidebar implement"). One column, one
 * pane, one shape.
 */

const POLL_MS = 10_000;

/**
 * The work behind a conversation, kept fresh while anything runs.
 * @param conversationId - The conversation, or null for a new one.
 * @param turnIdle - No turn is running (a turn that started work is a reason to read again).
 * @param initial
 */
export function useConversationWork(conversationId: number | null, turnIdle: boolean, initial: WorkView | null = null) {
  const [view, setView] = useState<WorkView | null>(initial);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    if (conversationId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect -- a thread with no id has no work behind it
      setView(null);
      return;
    }
    let cancelled = false;
    Promise.resolve()
      .then(() => client.work.forConversation({ conversationId }))
      .then((next) => {
        if (!cancelled) {
          setView(next);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, turnIdle, tick]);
  const running = view?.running.length ?? 0;
  useEffect(() => {
    if (running === 0) {
      return;
    }
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [running, refresh]);
  return { view, refresh };
}

/**
 * What the chip says: "2 running", "1 finished, 1 running", "3 finished".
 * @param view - The work.
 */
export function chipLine(view: WorkView): string | null {
  const r = view.running.length;
  const f = view.finished.length;
  if (r === 0 && f === 0) {
    return null;
  }
  const finished = f > 0 ? `${f} finished` : null;
  const running = r > 0 ? `${r} running` : null;
  return [finished, running].filter(Boolean).join(', ');
}

/**
 * What runs, named in the runs' own words, so the thread says what is
 * happening without a click: "Researching Google's top results for 3 pages ·
 * briefs next", then "+1 more". Null when nothing runs. The title is the
 * run's, as the work list returns it; nothing is renamed here.
 * @param view - The work.
 */
export function runningLine(view: WorkView): string | null {
  const [first, ...rest] = view.running;
  if (!first) {
    return null;
  }
  return rest.length > 0 ? `${first.title} + ${rest.length} more` : first.title;
}

function duration(item: WorkItem, now: number): string {
  const end = item.endedAt ? new Date(item.endedAt).getTime() : now;
  return formatElapsed(Math.max(0, Math.round((end - new Date(item.startedAt).getTime()) / 1000)));
}

const STATE_WORDS: Record<WorkItem['state'], string> = { running: 'Running', done: 'Completed', failed: 'Failed', stopped: 'Stopped', waiting: 'Waiting on you' };

function WorkRow({ item, onStop, now }: { item: WorkItem; onStop?: (item: WorkItem) => void; now: number }) {
  return (
    <li className="flex items-start gap-2 rounded-xl border border-border/70 bg-background px-3 py-2.5" data-testid="work-item" data-state={item.state}>
      <div className="min-w-0 flex-1">
        <Link href={item.href} className="block truncate text-[13.5px] text-foreground hover:underline" data-testid="work-item-link">{item.title}</Link>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {item.what}
          {' · '}
          <span className={item.state === 'failed' ? 'text-[var(--brand-fail)]' : undefined}>{STATE_WORDS[item.state]}</span>
          {' · '}
          <span className="tabular-nums">{duration(item, now)}</span>
        </p>
      </div>
      {onStop && item.canStop && (
        <button
          type="button"
          onClick={() => onStop(item)}
          aria-label={`Stop ${item.title}`}
          data-testid="work-item-stop"
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <Square className="size-3.5 fill-current" aria-hidden />
        </button>
      )}
    </li>
  );
}

/**
 * The panel: running work first, with Stop; then "Finished N", folded.
 * @param props - The panel.
 * @param props.view - The work.
 * @param props.onStop - Stops one.
 */
export function RunningWorkPanel({ view, onStop }: { view: WorkView; onStop: (item: WorkItem) => void }) {
  const [showFinished, setShowFinished] = useState(false);
  const [now] = useState(() => Date.now());
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="running-work-panel">
      {view.running.length > 0
        ? <ul className="flex flex-col gap-2">{view.running.map(item => <WorkRow key={item.key} item={item} onStop={onStop} now={now} />)}</ul>
        : <p className="text-[13px] text-muted-foreground">Nothing is running.</p>}
      {view.finished.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowFinished(v => !v)} aria-expanded={showFinished} className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground max-md:min-h-11" data-testid="work-finished-toggle">
            {`Finished ${view.finished.length}`}
            {showFinished ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          </button>
          {showFinished && <ul className="mt-2 flex flex-col gap-2">{view.finished.map(item => <WorkRow key={item.key} item={item} now={now} />)}</ul>}
        </div>
      )}
    </div>
  );
}

/**
 * The chip in the thread; tapping it opens the work in the preview pane. Nothing when there is no work.
 * @param props - The chip.
 * @param props.view - The work behind the conversation.
 * @param props.conversationId - The conversation it is behind.
 */
export function RunningWorkChip({ view, conversationId }: { view: WorkView | null; conversationId: number | null }) {
  const line = view ? chipLine(view) : null;
  if (!view || !line || conversationId === null) {
    return null;
  }
  // The work by name inline; the count and the chevron keep the detail one tap away.
  const naming = runningLine(view);
  return (
    <button
      type="button"
      onClick={e => openPreview(workPreviewRef(conversationId), e.currentTarget)}
      data-testid="running-work-chip"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 py-1 text-[12.5px] text-muted-foreground transition hover:text-foreground max-md:min-h-11"
    >
      {view.running.length > 0 && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
      {naming && <span className="min-w-0 truncate text-foreground/85" data-testid="running-work-names">{naming}</span>}
      <span className={naming ? 'shrink-0' : 'truncate'}>{naming ? `· ${line}` : line}</span>
      <ChevronRight className="size-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/**
 * The work as the preview pane draws it: the panel, kept fresh while anything runs, with Stop.
 * @param props - The pane body.
 * @param props.conversationId - The conversation.
 * @param props.initial - What the preview resolver read.
 */
export function ConversationWorkPane({ conversationId, initial }: { conversationId: number; initial: WorkView }) {
  const { view, refresh } = useConversationWork(conversationId, true, initial);
  const stop = (item: WorkItem) => {
    void client.work.stop({ key: item.key }).catch(() => null).then(refresh);
  };
  return <RunningWorkPanel view={view ?? initial} onStop={stop} />;
}

/**
 * The chip wired to a chat session.
 * @param props - The session.
 * @param props.session - Its conversation and whether a turn runs.
 * @param props.session.conversationId - The conversation.
 * @param props.session.isStreaming - A turn runs.
 */
export function ConversationWork({ session }: { session: { conversationId: number | null; isStreaming?: boolean } }) {
  const { view } = useConversationWork(session.conversationId, !session.isStreaming);
  return <RunningWorkChip view={view} conversationId={session.conversationId} />;
}

/**
 * The chip as an item in the thread, just above the active Decision.
 * @param session - The chat session.
 * @param session.conversationId - The conversation.
 * @param session.isStreaming - A turn runs.
 */
export function workBlock(session: { conversationId: number | null; isStreaming?: boolean }): { key: string; afterIndex: number; node: React.ReactNode } {
  return { key: 'conversation-work', afterIndex: Number.MAX_SAFE_INTEGER, node: <ConversationWork session={session} /> };
}
