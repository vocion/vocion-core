'use client';

import type { SelectionForChange } from '@/features/dashboard/context/AskAboutThis';
import { History, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CommentPopover } from '@/features/comments/AnchoredComments';
import { AskAboutThis } from '@/features/dashboard/context/AskAboutThis';
import { openPreview } from '@/features/preview/previewState';
import { useRouter } from '@/libs/I18nNavigation';
import { client } from '@/libs/Orpc';

/**
 * A record page declares its Change intent (backlog 035) — one element,
 * rendered once anywhere on the page, the way `RecordContext` declares the
 * record.
 *
 * Select words on the record and the selection control offers Ask and
 * Change — the same `AskAboutThis` toolbar every page uses. Ask opens the
 * conversation with the passage, as everywhere. Change asks what the words
 * should say instead and writes it into the field they belong to through
 * `objects.update_meta`: done for the person with Undo, a new version of the
 * record's body, and on its History.
 *
 * `History` is the one visible control: it opens the record's versions in
 * the preview panel (`record_history`), where each carries Restore.
 * @param props - Component props.
 * @param props.objectId - The record (`business_object.id`).
 * @param props.title - The record's title, for the conversation's chip.
 * @param props.selectionRoot - CSS selector for the region whose text belongs to the record.
 * @param props.showHistory - Render the History control here (default true).
 */
export function RecordChangeIntent({ objectId, title, selectionRoot, showHistory = true }: { objectId: number; title?: string; selectionRoot: string; showHistory?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<SelectionForChange | null>(null);
  const [receipt, setReceipt] = useState<{ kind: 'done'; runId: number; label: string; version: number | null } | { kind: 'pending'; label: string } | { kind: 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (instruction: string) => {
    if (!pending || !instruction.trim()) {
      return;
    }
    const selection = pending;
    setPending(null);
    setBusy(true);
    try {
      const out = await client.businessObject.change({ id: objectId, quote: selection.text, instruction: instruction.trim(), ...(selection.field ? { field: selection.field } : {}) });
      if (out.status === 'done' && out.runId) {
        setReceipt({ kind: 'done', runId: out.runId, label: out.label, version: out.version });
        router.refresh();
      } else if (out.status === 'pending') {
        setReceipt({ kind: 'pending', label: out.label });
      } else {
        setReceipt({ kind: 'error', message: out.error ?? `The change is ${out.status}.` });
      }
    } catch (err) {
      setReceipt({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const undo = async (runId: number) => {
    setBusy(true);
    try {
      await client.review.undoAction({ id: runId });
      setReceipt(null);
      router.refresh();
    } catch (err) {
      setReceipt({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Where the note box opens: at the selection when it had a box, else the
  // top of the window rather than nowhere.
  const rect = pending?.rect ?? (pending ? new DOMRect(16, 16, 0, 0) : null);

  return (
    <>
      <AskAboutThis
        record={{ type: 'object', id: String(objectId), ...(title ? { label: title } : {}) }}
        selectionRoot={selectionRoot}
        variant="none"
        changeable
        onChange={setPending}
      />
      {pending && rect && (
        <CommentPopover
          pending={{ rect }}
          startWriting
          changeLabel="Change"
          placeholder="What should it say instead?"
          onAdd={note => void change(note)}
          onCancel={() => setPending(null)}
        />
      )}
      {showHistory && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={e => openPreview({ type: 'record_history', id: String(objectId) }, e.currentTarget)}
              data-testid="record-history-open"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <History className="size-3.5" aria-hidden />
              History
            </button>
          </TooltipTrigger>
          <TooltipContent>Every version of this record — who, when, why — with Restore</TooltipContent>
        </Tooltip>
      )}
      {receipt && (
        <div role="status" data-testid="record-change-receipt" className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-[13px] shadow-(--shadow-pop)">
          {receipt.kind === 'done' && (
            <>
              <span>{`Changed ${receipt.label.toLowerCase()}${receipt.version ? ` — v${receipt.version}` : ''}.`}</span>
              <button type="button" disabled={busy} onClick={() => void undo(receipt.runId)} className="inline-flex items-center gap-1 underline underline-offset-2">
                <RotateCcw className="size-3" aria-hidden />
                Undo
              </button>
            </>
          )}
          {receipt.kind === 'pending' && <span>{`The change to ${receipt.label.toLowerCase()} is waiting for a person in Review.`}</span>}
          {receipt.kind === 'error' && <span className="text-[var(--brand-fail)]">{receipt.message}</span>}
          <button type="button" onClick={() => setReceipt(null)} className="text-muted-foreground hover:text-foreground">Dismiss</button>
        </div>
      )}
    </>
  );
}
