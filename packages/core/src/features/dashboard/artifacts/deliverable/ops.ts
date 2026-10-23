/**
 * What a person does in the deliverable pane, as the engine's own
 * operations — `edit_deck`'s for a deck, `edit_document`'s for a document —
 * with the version's one-line summary, and the same ops applied locally so
 * the pane can show the result before the engine has re-rendered it.
 *
 * One edit is one batch is one version (`artifacts.update` with `ops`).
 */

import type { DeliverableKind, DeliverablePage } from './pages';
import type { DeckSpec, DocumentSpec } from '@/libs/cards/specs';
import type { DeckOp } from '@/libs/decks/edit';
import type { DocumentOp } from '@/libs/documents/edit';
import { applyDeckOps } from '@/libs/decks/edit';
import { applyDocumentOps } from '@/libs/documents/edit';
import { freshSlideId, withSectionId } from './textEdit';

export type PageEdit
  /** The page's new HTML, after a text edit on it. */
  = | { type: 'text'; key: string; html: string }
    | { type: 'notes'; key: string; notes: string }
  /** `to` is the new 1-based position. */
    | { type: 'move'; key: string; to: number }
    | { type: 'duplicate'; key: string }
    | { type: 'remove'; key: string };

export type PlannedEdit = {
  ops: Array<DeckOp | DocumentOp>;
  summary: string;
  /** The page to show once it lands. */
  select: string;
  /** Pages whose screenshot no longer shows what is on them. */
  touched: string[];
};

/**
 * The ops and summary for one edit, or null when it cannot apply (a page that is gone).
 * @param kind - Deck or document.
 * @param pages - The pages as the person sees them.
 * @param edit - What they did.
 */
export function planEdit(kind: DeliverableKind, pages: DeliverablePage[], edit: PageEdit): PlannedEdit | null {
  const page = pages.find(p => p.key === edit.key);
  if (!page) {
    return null;
  }
  const unit = kind === 'deck' ? 'slide' : 'sheet';
  const n = page.n;
  switch (edit.type) {
    case 'text':
      return {
        ops: kind === 'deck' ? [{ op: 'replace_slide', id: page.key, html: edit.html }] : [{ op: 'replace_sheet', n, html: edit.html }],
        summary: `Edited text on ${unit} ${n}`,
        select: page.key,
        touched: [page.key],
      };
    case 'notes':
      return kind === 'deck'
        ? { ops: [{ op: 'set_notes', id: page.key, notes: edit.notes }], summary: `Edited the notes on slide ${n}`, select: page.key, touched: [] }
        : null;
    case 'move': {
      const to = Math.min(Math.max(1, edit.to), pages.length);
      if (to === n) {
        return null;
      }
      return {
        ops: kind === 'deck' ? [{ op: 'move_slide', id: page.key, to }] : [{ op: 'move_sheet', n, to }],
        summary: `Moved ${unit} ${n} to position ${to}`,
        select: kind === 'deck' ? page.key : String(to),
        touched: kind === 'deck' ? [] : pages.map(p => p.key),
      };
    }
    case 'duplicate': {
      if (kind === 'deck') {
        const id = freshSlideId(page.key, pages.map(p => p.key));
        const html = withSectionId(page.html, id);
        return html
          ? { ops: [{ op: 'insert_slide', html, after: page.key }], summary: `Added slide ${n + 1}, a copy of slide ${n}`, select: id, touched: [id] }
          : null;
      }
      return {
        ops: [{ op: 'insert_sheet', after: n, html: page.html }],
        summary: `Added sheet ${n + 1}, a copy of sheet ${n}`,
        select: String(n + 1),
        touched: pages.filter(p => p.n > n).map(p => p.key).concat(String(pages.length + 1)),
      };
    }
    case 'remove': {
      if (pages.length <= 1) {
        return null;
      }
      const next = pages[n] ?? pages[n - 2]!;
      return {
        ops: kind === 'deck' ? [{ op: 'remove_slide', id: page.key }] : [{ op: 'remove_sheet', n }],
        summary: `Removed ${unit} ${n}`,
        select: kind === 'deck' ? next.key : String(Math.min(n, pages.length - 1)),
        touched: kind === 'deck' ? [] : pages.filter(p => p.n >= n).map(p => p.key),
      };
    }
  }
}

/**
 * The spec with the ops applied, for the optimistic view; null when the
 * local apply fails (the engine's answer then decides).
 * @param kind - Deck or document.
 * @param spec - The spec the person is looking at.
 * @param ops - The planned ops.
 */
export function applyLocally(kind: DeliverableKind, spec: Record<string, unknown>, ops: PlannedEdit['ops']): Record<string, unknown> | null {
  try {
    if (kind === 'deck') {
      return applyDeckOps(spec as DeckSpec, ops as DeckOp[]).spec as unknown as Record<string, unknown>;
    }
    const html = applyDocumentOps((spec as DocumentSpec).html, ops as DocumentOp[]).html;
    return { ...spec, html };
  } catch {
    return null;
  }
}
