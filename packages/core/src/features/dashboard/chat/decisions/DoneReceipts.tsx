'use client';

import type { DoneReceipt } from '@/libs/decisions/receipt';
import { Check, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { announceSetupChanged } from '@/features/dashboard/setupChanged';
import { changesText } from '@/libs/decisions/receipt';
import { Link } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/** Where an undo has got to, per run. */
type UndoState = Record<number, 'working' | 'undone' | 'failed'>;

/**
 * THE DONE RECEIPT — one quiet line under a turn for each thing it did inside
 * the trust bar, with no card and no question: "Done. Northwind renewal
 * updated: Deal stage: Proposal → Contract sent · Undo" (a teammate's walk,
 * 2026-10-28: no separate Completed bar, no run pill, no record pill, no
 * sentence on why it ran — that is the line's tooltip). The record's name is
 * the link; an action that says what it made links that ("Pull request
 * opened: example-org/northwind-site#12").
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
      // Something was taken back: a setup step may be undone (the checklist re-reads).
      announceSetupChanged();
    } catch {
      setUndo(prev => ({ ...prev, [runId]: 'failed' }));
    }
  };
  const linkClass = 'text-foreground/85 underline-offset-2 hover:text-foreground hover:underline';
  return (
    <ul className="mt-3 space-y-1" data-testid="done-receipts">
      {receipts.map((r) => {
        const state = r.status === 'undone' ? 'undone' : undo[r.runId];
        const external = (href: string) => /^https:\/\//.test(href);
        const linkTo = (href: string | undefined, text: string) => (href
          ? external(href)
            ? <a href={href} target="_blank" rel="noreferrer" className={linkClass}>{text}</a>
            : <Link href={href} className={linkClass}>{text}</Link>
          : <span className="text-foreground/85">{text}</span>);
        const body = r.outcome
          ? (
              <>
                {r.outcome.text}
                {r.outcome.href && (
                  <>
                    {': '}
                    {linkTo(r.outcome.href, r.outcome.linkLabel ?? r.outcome.href)}
                  </>
                )}
              </>
            )
          : r.record && r.changes && r.changes.length > 0
            ? (
                <>
                  {linkTo(r.record.href ?? r.href, r.record.label)}
                  {` updated: ${changesText(r.changes)}`}
                </>
              )
            : linkTo(r.href, r.label);
        return (
          <li key={r.runId} className="flex flex-wrap items-baseline gap-x-1.5 text-[13px] text-muted-foreground" title={r.why} data-testid={`done-receipt-${r.runId}`} data-undoable={r.undoable}>
            {state === 'undone'
              ? <RotateCcw className="size-3.5 shrink-0 self-center" aria-hidden />
              : <Check className="size-3.5 shrink-0 self-center text-[var(--brand-pass)]" aria-hidden />}
            <span className="shrink-0 font-medium text-foreground/85">{state === 'undone' ? 'Undone.' : 'Done.'}</span>
            <span className="min-w-0 break-words">{body}</span>
            {r.undoable && state !== 'undone' && (
              <button
                type="button"
                onClick={() => void run(r.runId)}
                disabled={state === 'working'}
                data-testid={`done-receipt-undo-${r.runId}`}
                className="shrink-0 text-[12px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline disabled:opacity-50"
              >
                {state === 'failed' ? 'Undo failed — retry' : 'Undo'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
