'use client';

/**
 * The chip under a turn where the system improved ITSELF — "Updated the wiki
 * · Founder voice · v3", with Undo.
 *
 * It exists for the same reason the artifact chip does: without a mark in
 * the transcript there is nothing to say which turn changed what, and a
 * self-update is the change a person most wants to be able to find. Chris,
 * 2026-09-18: *"That should show up in the log and as inline chips when it
 * happens organically in chat."*
 *
 * Two rules it holds to:
 *
 *  - **One chip per turn, never a stack.** Several self-updates in one turn
 *    collapse into a single line that counts them and opens to list them,
 *    each undoable. Three chips under one answer is the noise this was built
 *    to avoid.
 *  - **The same weight as an artifact chip.** One quiet line, the same
 *    border, the same type size. A self-update is normal, not an alarm.
 *
 * Undo is the same call the review queue makes (`review.undoAction`), so
 * there is one undo path in the product and the chip is not a second one.
 */

import type { SelfUpdateNoun, SelfUpdateReceipt } from '@/libs/actions/selfUpdate';
import { BookOpen, Bot, Brain, ListChecks, Puzzle, RotateCcw, Sparkles, Target, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { selfUpdateGroupLabel, selfUpdateLine, selfUpdateQueueHref } from '@/libs/actions/selfUpdate';
import { client } from '@/libs/Orpc';

const NOUN_ICON: Record<SelfUpdateNoun, typeof Bot> = {
  wiki: BookOpen,
  memory: Brain,
  playbook: ListChecks,
  mission: Target,
  prompt: Bot,
  capability: Puzzle,
  teammate: UserPlus,
};

/** Where an undo has got to, per run. */
type UndoState = Record<number, 'working' | 'undone' | 'failed'>;

export function SelfUpdateChips({ updates }: { updates: SelfUpdateReceipt[] }) {
  const [open, setOpen] = useState(false);
  const [undone, setUndone] = useState<UndoState>({});

  if (updates.length === 0) {
    return null;
  }

  const undo = async (runId: number) => {
    setUndone(prev => ({ ...prev, [runId]: 'working' }));
    try {
      await client.review.undoAction({ id: runId });
      setUndone(prev => ({ ...prev, [runId]: 'undone' }));
    } catch {
      setUndone(prev => ({ ...prev, [runId]: 'failed' }));
    }
  };

  const many = updates.length > 1;
  const Icon = many ? Sparkles : NOUN_ICON[updates[0]!.noun];
  const label = selfUpdateGroupLabel(updates);

  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" data-self-update-chips={updates.length}>
      <li className="max-w-full">
        <div className="inline-flex max-w-full flex-col items-start gap-1 rounded-md border border-border bg-background px-2 py-1 text-[12px] font-medium text-foreground/85">
          <div className="flex max-w-full items-center gap-1.5">
            {many
              ? (
                  <button
                    type="button"
                    onClick={() => setOpen(v => !v)}
                    aria-expanded={open}
                    data-testid="self-update-chip"
                    className="inline-flex max-w-full items-center gap-1.5 text-left transition hover:text-foreground"
                  >
                    <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{label}</span>
                  </button>
                )
              : (
                  <span className="inline-flex max-w-full items-center gap-1.5" data-testid="self-update-chip">
                    <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{undone[updates[0]!.runId] === 'undone' ? `${label} · undone` : label}</span>
                  </span>
                )}
            {!many && <UndoButton update={updates[0]!} state={undone[updates[0]!.runId]} onUndo={undo} />}
          </div>
          {many && open && (
            <ul className="flex w-full flex-col gap-1 pt-1" data-testid="self-update-list">
              {updates.map(u => (
                <li key={u.runId} className="flex items-center gap-1.5 text-[12px] font-normal text-muted-foreground">
                  <span className="truncate">
                    {selfUpdateLine(u)}
                    {undone[u.runId] === 'undone' ? ' · undone' : ''}
                  </span>
                  <UndoButton update={u} state={undone[u.runId]} onUndo={undo} />
                </li>
              ))}
              <li>
                <a
                  href={selfUpdateQueueHref('decided')}
                  className="text-[11px] font-normal text-muted-foreground underline-offset-2 hover:underline"
                >
                  Everything it has taught itself
                </a>
              </li>
            </ul>
          )}
        </div>
      </li>
    </ul>
  );
}

/**
 * Undo for one self-update. Absent when there is nothing to put back — a
 * proposal still waiting on a person has not changed anything yet.
 * @param props - The entry and its undo state.
 * @param props.update - The self-update.
 * @param props.state - Where its undo has got to.
 * @param props.onUndo - Runs the undo.
 */
function UndoButton({ update, state, onUndo }: {
  update: SelfUpdateReceipt;
  state: UndoState[number] | undefined;
  onUndo: (runId: number) => void | Promise<void>;
}) {
  if (update.status !== 'applied' || state === 'undone') {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => void onUndo(update.runId)}
      disabled={state === 'working'}
      data-testid={`self-update-undo-${update.runId}`}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1 text-[11px] font-normal text-muted-foreground transition hover:text-foreground disabled:opacity-50"
    >
      <RotateCcw className="size-3" aria-hidden />
      {state === 'failed' ? 'Undo failed — retry' : 'Undo'}
    </button>
  );
}
