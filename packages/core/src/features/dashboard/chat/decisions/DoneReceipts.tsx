'use client';

import type { DoneReceipt } from '@/libs/decisions/receipt';
import { Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/** Where an undo has got to, per run. */
type UndoState = Record<number, 'working' | 'undone' | 'failed'>;

/**
 * THE DONE RECEIPT — one quiet line under a turn for each thing it did inside
 * the trust bar, with no card and no question: "Done · Moved Northwind to
 * Negotiation · Undo".
 *
 * Undo appears ONLY where the action's kind defines one
 * (`libs/actions/undoable.ts`): an email that went out says Done and nothing
 * else, because nothing can unsend it. Undo is the review queue's own call
 * (`review.undoAction`), so there is one undo path in the product.
 * @param props - The receipts.
 * @param props.receipts - What the turn did.
 */
export function DoneReceipts({ receipts }: { receipts: DoneReceipt[] }) {
  const [undo, setUndo] = useState<UndoState>({});
  if (receipts.length === 0) {
    return null;
  }
  const run = async (runId: number) => {
    setUndo(prev => ({ ...prev, [runId]: 'working' }));
    try {
      await client.review.undoAction({ id: runId });
      setUndo(prev => ({ ...prev, [runId]: 'undone' }));
    } catch {
      setUndo(prev => ({ ...prev, [runId]: 'failed' }));
    }
  };
  return (
    <ul className="mt-3 space-y-1" data-testid="done-receipts">
      {receipts.map((r) => {
        const state = r.status === 'undone' ? 'undone' : undo[r.runId];
        return (
          <li key={r.runId} className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid={`done-receipt-${r.runId}`} data-undoable={r.undoable}>
            <Check className="size-3.5 shrink-0 text-[var(--brand-pass)]" aria-hidden />
            <span className="shrink-0 font-medium text-foreground/85">{state === 'undone' ? 'Undone' : 'Done'}</span>
            <span aria-hidden>·</span>
            {r.href
              ? <Link href={r.href} className="min-w-0 truncate hover:text-foreground hover:underline">{r.label}</Link>
              : <span className="min-w-0 truncate">{r.label}</span>}
            {r.undoable && state !== 'undone' && (
              <button
                type="button"
                onClick={() => void run(r.runId)}
                disabled={state === 'working'}
                data-testid={`done-receipt-undo-${r.runId}`}
                className="ml-1 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-foreground/80 transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3" aria-hidden />
                {state === 'failed' ? 'Undo failed — retry' : 'Undo'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
