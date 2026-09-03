'use client';

import type { TextAnchor } from '@/libs/anchors/resolve';
import { X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { buildAnchor } from '@/libs/anchors/resolve';
import { client } from '@/libs/Orpc';
import { clearMarks, markRange, offsetWithin } from './anchorSelection';

/**
 * The comment layer: select a span, say what should change, and the note
 * lands as a chip on the page's agent surface (018, implemented per 043).
 *
 * Six behaviours the design settled:
 *   1. any selection inside a commentable region raises the control AT the
 *      selection, from the first character;
 *   2. the text stays highlighted while the note is written;
 *   3. Add change leaves a numbered highlight and puts a chip on the agent
 *      surface;
 *   4. chips collapse to a receipt and expand to the change;
 *   5. clicking either one lights the other, both ways;
 *   6. a highlight clears when the agent APPLIES the change — verified, not
 *      on a timer.
 *
 * The selection stays native until commenting begins, so ordinary copying
 * still works and focus is never stolen from the composer.
 */

export type CommentTargetProps = {
  /** The document being commented on, e.g. `lead_brief:412`. */
  targetRef: string;
  /**
   * The element containing the commentable regions. Passed in as state
   * rather than held as a ref inside the hook: a hook that returns a ref
   * makes every read of its result a ref access during render.
   */
  root: HTMLElement | null;
};

export type ResolvedCommentView = {
  id: number;
  field: string;
  note: string;
  status: string;
  anchor: TextAnchor;
  range: { start: number; end: number; exact: boolean } | null;
};

/** Enough to decide whether the control fits below the selection. */
const POPOVER_HEIGHT = 120;

/** Marks the layer owns, so clearing never touches anyone else's marks. */
const MARK_SELECTOR = 'mark[data-anchor-id]';
/** The while-you-write highlight, gone as soon as the control closes. */
const PROVISIONAL_SELECTOR = 'mark[data-anchor-pending]';

/**
 * Hook owning the comment layer for one target: the stored comments, the
 * selection popover, and the highlight painting.
 * @param props - Which document, and the container holding its regions.
 * @param props.targetRef - The document being commented on.
 * @param props.root - The element holding the commentable regions.
 * @returns State and handlers for the commentable region and the chip list.
 */
export function useAnchoredComments({ targetRef, root }: CommentTargetProps) {
  const [comments, setComments] = useState<ResolvedCommentView[]>([]);
  const [pending, setPending] = useState<{ field: string; anchor: TextAnchor; rect: DOMRect; start: number; end: number } | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  /**
   * The text of every commentable region, read from the DOM.
   *
   * Deliberately the RENDERED text, not the source the server holds: a brief
   * section is markdown, so `**Name:**` is four characters longer on the
   * server than on screen. Anchoring against the source would store offsets
   * that point at different words than the reviewer selected. The reviewer
   * commented on what they saw, so what they saw is the text of record.
   */
  const readFields = useCallback((): Record<string, string> => {
    if (!root) {
      return {};
    }
    const out: Record<string, string> = {};
    root.querySelectorAll<HTMLElement>('[data-comment-field]').forEach((el) => {
      const key = el.dataset.commentField;
      if (key) {
        out[key] = el.textContent ?? '';
      }
    });
    return out;
  }, [root]);

  const load = useCallback(async () => {
    try {
      const rows = await client.anchoredComments.list({ targetRef, fieldText: readFields() });
      setComments(rows as unknown as ResolvedCommentView[]);
    } catch (error) {
      console.warn('anchored comments: load failed', error);
    }
  }, [targetRef, readFields]);

  useEffect(() => {
    // Wait for the container: loading before the regions render would send
    // no field text, and an anchor cannot be resolved against text we do not
    // have. The state write happens after an await inside `load`, not
    // synchronously here — the rule cannot see through the async boundary.
    if (!root) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, root]);

  /* Paint: one pass, driven by the resolved ranges. Runs after every change
     so a re-render never leaves a stale highlight behind. */
  useEffect(() => {
    if (!root) {
      return;
    }
    clearMarks(root, MARK_SELECTOR);
    for (const c of comments) {
      if (!c.range || c.status === 'applied') {
        continue;
      }
      const region = root.querySelector<HTMLElement>(`[data-comment-field="${CSS.escape(c.field)}"]`);
      if (!region) {
        continue;
      }
      markRange(region, c.range.start, c.range.end, {
        'data-anchor-id': String(c.id),
        'class': `cursor-pointer rounded-sm px-0.5 ${activeId === c.id ? 'bg-brand-amber/40' : 'bg-brand-amber/15'}`,
      });
    }
  }, [comments, activeId, root]);

  /* A selection inside a commentable region raises the control at it. The
     selection is left native — nothing is wrapped until a note begins. */
  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if ((e.target as HTMLElement)?.closest?.('[data-comment-popover]')) {
        return;
      }
      const sel = window.getSelection();
      const text = sel ? String(sel).trim() : '';
      if (!sel || sel.rangeCount === 0 || text.length === 0) {
        setPending(p => (p ? null : p));
        return;
      }
      const range = sel.getRangeAt(0);
      const node = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const region = (node as HTMLElement | null)?.closest?.<HTMLElement>('[data-comment-field]');
      if (!region || !root?.contains(region)) {
        return;
      }
      const field = region.dataset.commentField!;
      // Anchor against the region's own rendered text — the same string the
      // offsets below are measured in, and the same one `load` resolves with.
      const source = region.textContent ?? '';
      const start = offsetWithin(region, range.startContainer, range.startOffset);
      const end = offsetWithin(region, range.endContainer, range.endOffset);
      const anchor = buildAnchor(source, Math.min(start, end), Math.max(start, end));
      if (!anchor) {
        return;
      }
      setPending({
        field,
        anchor,
        rect: range.getBoundingClientRect(),
        start: Math.min(start, end),
        end: Math.max(start, end),
      });
    }
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [root]);

  /**
   * Commenting has begun (the reviewer clicked into the note): paint the
   * span so it stays visibly highlighted while they write. Until this
   * moment the browser's own selection does that job, which is why nothing
   * is wrapped on mouseup — the selection stays native, and copyable.
   */
  const beginCommenting = useCallback(() => {
    if (!pending || !root) {
      return;
    }
    clearMarks(root, PROVISIONAL_SELECTOR);
    const region = root.querySelector<HTMLElement>(`[data-comment-field="${CSS.escape(pending.field)}"]`);
    if (region) {
      markRange(region, pending.start, pending.end, {
        'data-anchor-pending': '1',
        'class': 'rounded-sm bg-brand-amber/40 px-0.5',
      });
    }
  }, [pending, root]);

  /* The provisional mark lives only as long as the control does. */
  useEffect(() => {
    if (!pending && root) {
      clearMarks(root, PROVISIONAL_SELECTOR);
    }
  }, [pending, root]);

  const addComment = useCallback(async (note: string) => {
    if (!pending || !note.trim()) {
      return;
    }
    try {
      await client.anchoredComments.create({
        targetRef,
        field: pending.field,
        anchor: pending.anchor,
        note: note.trim(),
      });
      setPending(null);
      if (root) {
        clearMarks(root, PROVISIONAL_SELECTOR);
      }
      window.getSelection()?.removeAllRanges();
      await load();
    } catch (error) {
      console.warn('anchored comments: create failed', error);
    }
  }, [pending, targetRef, load, root]);

  const removeComment = useCallback(async (id: number) => {
    try {
      await client.anchoredComments.delete({ id });
      await load();
    } catch (error) {
      console.warn('anchored comments: delete failed', error);
    }
  }, [load]);

  /** Called when an apply verifiably completed — the highlights then clear. */
  const applyComments = useCallback(async (ids: number[], runId?: number) => {
    if (ids.length === 0) {
      return;
    }
    try {
      await client.anchoredComments.apply({ ids, ...(runId ? { runId } : {}) });
      await load();
    } catch (error) {
      console.warn('anchored comments: apply failed', error);
    }
  }, [load]);

  /** Both ways: a chip lights its highlight and scrolls it into view. */
  const focusComment = useCallback((id: number) => {
    setActiveId(id);
    root
      ?.querySelector<HTMLElement>(`mark[data-anchor-id="${id}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [root]);

  /* …and a highlight lights its chip. */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement)?.closest?.<HTMLElement>(MARK_SELECTOR);
      if (mark) {
        setActiveId(Number(mark.dataset.anchorId));
      }
    }
    root?.addEventListener('click', onClick);
    return () => root?.removeEventListener('click', onClick);
  }, [root]);

  return {
    comments,
    open: comments.filter(c => c.status !== 'applied'),
    pending,
    beginCommenting,
    cancelPending: () => setPending(null),
    addComment,
    removeComment,
    applyComments,
    activeId,
    setActiveId,
    focusComment,
    reload: load,
  };
}

/**
 * The control at the selection: says what the highlighted text should become,
 * and hands the note to the page's agent surface.
 * @param root0 - Component props.
 * @param root0.pending - The armed selection, or null.
 * @param root0.onAdd - Store the note.
 * @param root0.onCancel - Drop the selection.
 */
export function CommentPopover({ pending, onAdd, onCancel, onBegin }: {
  pending: { rect: DOMRect } | null;
  onAdd: (note: string) => void;
  onCancel: () => void;
  /** Commenting has begun — the layer paints the span so it stays visible. */
  onBegin?: () => void;
}) {
  const [note, setNote] = useState('');

  // Deliberately NOT auto-focused. Taking focus collapses the browser's own
  // selection, which would both hide the span the reviewer is commenting on
  // and break copying the text they just highlighted. The reviewer clicks
  // into the note when they mean to write one, and that is when the span
  // gets its own highlight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && pending) {
        onCancel();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending, onCancel]);

  if (!pending) {
    return null;
  }

  return (
    <div
      data-comment-popover
      role="dialog"
      aria-label="Comment on the selection"
      style={{
        left: Math.max(8, Math.min(pending.rect.left, window.innerWidth - 320)),
        // Below the selection when there is room, above it when there is not:
        // a selection near the bottom of the window would otherwise put the
        // control off-screen, where it cannot be answered.
        top: pending.rect.bottom + 8 + POPOVER_HEIGHT > window.innerHeight
          ? Math.max(8, pending.rect.top - POPOVER_HEIGHT - 8)
          : pending.rect.bottom + 8,
      }}
      className="fixed z-50 w-[300px] rounded-xl border border-border bg-background p-2.5 shadow-xl"
    >
      <textarea
        value={note}
        onFocus={onBegin}
        onChange={e => setNote(e.target.value)}
        placeholder="What should change here?"
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-amber"
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onAdd(note)}
          disabled={!note.trim()}
          className="rounded-lg bg-brand-amber px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-brand-amber-deep disabled:bg-muted disabled:text-muted-foreground/60"
        >
          Add change
        </button>
      </div>
    </div>
  );
}

/**
 * The chips: collapsed as a receipt, expanded as the change, one open at a
 * time, each lighting its own highlight.
 * @param root0 - Component props.
 * @param root0.comments - The open comments.
 * @param root0.activeId - Which chip is expanded.
 * @param root0.onFocus - Expand a chip and light its highlight.
 * @param root0.onRemove - Drop a comment.
 */
export function CommentChips({ comments, activeId, onFocus, onRemove }: {
  comments: ResolvedCommentView[];
  activeId: number | null;
  onFocus: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  if (comments.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 px-4 pb-1.5" data-comment-chips>
      {comments.map((c, i) => {
        const open = activeId === c.id;
        const orphaned = c.status === 'orphaned';
        return (
          <div key={c.id} className="rounded-lg border border-border bg-muted/40 text-xs">
            <div className="flex items-center gap-1.5 px-2 py-1">
              <button
                type="button"
                onClick={() => onFocus(c.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-brand-amber/25 text-[9px] font-bold text-brand-amber-deep">
                  {i + 1}
                </span>
                <span className={`min-w-0 flex-1 truncate ${orphaned ? 'text-muted-foreground line-through' : 'text-foreground/80'}`}>
                  “
                  {c.anchor.quote}
                  ”
                </span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(c.id)}
                aria-label={`Remove comment ${i + 1}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </div>
            {open && (
              <div className="border-t border-border/60 px-2 py-1.5 text-[12px]">
                <p className="text-foreground/90">{c.note}</p>
                {orphaned && (
                  <p className="mt-1 text-muted-foreground">
                    The text this pointed at has changed, so the highlight is gone. The note still sends.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
