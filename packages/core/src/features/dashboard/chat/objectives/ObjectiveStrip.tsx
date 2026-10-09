'use client';

import type { ObjectiveView } from '@/libs/objectives/objective';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useId, useState } from 'react';
import { progressLine } from '@/libs/objectives/objective';
import { useObjective } from './useObjective';

/**
 * THE OBJECTIVE'S LINE — what the conversation is in the middle of, said
 * once, quietly, just above the docked Decision:
 *
 *   ● Setting up Software Factory · 2 of 3                    Stop
 *
 * Founder, 2026-10-09: "Does it give or should I have context mid
 * objective?" One line, never a card — the Decision below stays the one
 * thing asking (`docs/guides/decisions.md`). Tapping the line lists the
 * steps (done ✓, the one you are on, what is next); Stop pauses it and
 * leaves everything as it is ("Paused setting up … · Resume"); when the
 * last step is done it says so once and can be put away. Read from the
 * server (`useObjective`), so a reload and the drawer keep it; a new chat
 * offers "Resume setting up …" as its opening hint
 * (`libs/chat/openingHints.ts`).
 *
 * 44px to the thumb on a phone; the desktop keeps its density.
 * @param props - The strip.
 * @param props.view - The objective now.
 * @param props.onStop - Stop (pause) it.
 * @param props.onResume - Take it back up.
 */
export function ObjectiveStrip({ view, onStop, onResume }: { view: ObjectiveView; onStop: () => void; onResume: () => void }) {
  const [open, setOpen] = useState(false);
  const [putAway, setPutAway] = useState(false);
  const listId = useId();
  if (putAway) {
    return null;
  }
  const done = view.state === 'done';
  const stopped = view.state === 'stopped';
  const line = progressLine(view);
  const [what, where] = line.split(' · ');
  return (
    <div data-testid="objective-strip" data-state={view.state} className="mb-2 rounded-xl border border-border/70 bg-background/90 text-[12.5px] text-muted-foreground">
      {open && (
        <ol id={listId} data-testid="objective-steps" aria-label={`${view.name}: steps`} className="flex flex-col gap-1 border-b border-border/60 px-3 pt-2.5 pb-2">
          {view.steps.map((s, i) => {
            const current = i === view.current;
            return (
              <li key={s.key} data-testid="objective-step" data-done={s.done || undefined} data-current={current || undefined} className={`flex items-center gap-2 ${current ? 'font-medium text-foreground' : ''}`}>
                <span className={`grid size-4 shrink-0 place-items-center rounded-full ${s.done ? 'bg-[var(--brand-pass)]/15 text-[var(--brand-pass)]' : current ? 'border border-foreground/50' : 'border border-border'}`} aria-hidden>
                  {s.done && <Check className="size-3" />}
                </span>
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="sr-only">{s.done ? '(done)' : current ? '(you are here)' : '(next)'}</span>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex items-center gap-1 pr-1 pl-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          data-testid="objective-line"
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left transition-colors hover:text-foreground max-md:min-h-11"
        >
          {done
            ? <Check className="size-3.5 shrink-0 text-[var(--brand-pass)]" aria-hidden />
            : <span className={`size-1.5 shrink-0 rounded-full ${stopped ? 'bg-muted-foreground/50' : 'bg-brand-amber'}`} aria-hidden />}
          <span className="min-w-0 truncate">
            <span className="text-foreground">{what}</span>
            {where && (
              <>
                {' · '}
                <span data-testid="objective-progress">{where}</span>
              </>
            )}
          </span>
          {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronUp className="size-3.5 shrink-0" aria-hidden />}
          <span className="sr-only">{open ? 'Hide the steps' : 'Show the steps'}</span>
        </button>
        {done
          ? (
              <button type="button" onClick={() => setPutAway(true)} aria-label="Put this away" data-testid="objective-dismiss" className="grid size-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-hover hover:text-foreground max-md:size-11">
                <X className="size-3.5" aria-hidden />
              </button>
            )
          : (
              <button
                type="button"
                onClick={stopped ? onResume : onStop}
                data-testid={stopped ? 'objective-resume' : 'objective-stop'}
                className="shrink-0 rounded-md px-2 py-1 text-[12.5px] font-medium text-foreground/80 transition-colors hover:bg-surface-hover hover:text-foreground max-md:min-h-11"
              >
                {stopped ? 'Resume' : 'Stop'}
              </button>
            )}
      </div>
    </div>
  );
}

/**
 * The line wired to a chat session — what every surface with a composer puts
 * in the composer's `pinned` slot, above the dock.
 * @param props - The session.
 * @param props.session - The chat session (`useChatSession`): its conversation and whether a turn runs.
 * @param props.session.conversationId
 * @param props.session.isStreaming
 */
export function ConversationObjective({ session }: { session: { conversationId: number | null; isStreaming?: boolean } }) {
  const { view, stop, resume } = useObjective(session.conversationId, !session.isStreaming);
  if (!view) {
    return null;
  }
  return <ObjectiveStrip key={`${view.conversationId}:${view.plugin}`} view={view} onStop={stop} onResume={resume} />;
}
