/**
 * A deliverable as pages — the one model the deliverable pane draws, for a
 * deck (slides, keyed by id) and a document (sheets, keyed by position).
 *
 * Pure apart from the HTML string work the deck and document libs already
 * do; no DOM. Everything the pane shows about a page comes from here: its
 * label, its notes, the screenshot the last verify took, what that verify
 * and the buyer's read found on it, and the HTML that renders it alone in a
 * frame.
 */

import type { DeckSpec, DocumentRedTeam, DocumentSpec } from '@/libs/cards/specs';
import { buildDeckPage, SLIDE_HEIGHT, SLIDE_WIDTH } from '@/libs/decks/page';
import { normaliseSlideHtml, slideText } from '@/libs/decks/slides';
import { assemble, parseSheets, stripDocumentChrome } from '@/libs/documents/sheets';
import { artifactHref } from '@/libs/tools/artifacts/url';

export type DeliverableKind = 'deck' | 'document';

/** `DocumentFrame`'s `DOCUMENT_FRAME_WIDTH`: the width the house framework was tuned at. Kept here so this module stays free of React. */
export const SHEET_WIDTH = 850;
/** A US-Letter sheet at the framework's 850px layout, until the frame reports its real height. */
export const SHEET_HEIGHT_GUESS = 1100;

/** One thing the last verify or the buyer's read found on a page. Advice, never a blocker. */
export type PageFinding
  = | { kind: 'overflow'; px: number }
    | { kind: 'clipped'; what: string }
    | { kind: 'small-text'; what: string }
    | { kind: 'below-footer'; what: string }
    | { kind: 'unknown'; what: string }
    | { kind: 'asset'; what: string }
    | { kind: 'placeholder'; what: string }
    | { kind: 'no-notes' }
    | { kind: 'buyer'; severity: 'block' | 'fix' | 'consider'; finding: string; fix: string };

export type DeliverablePage = {
  /** Slide id for a deck; the 1-based sheet number, as a string, for a document. */
  key: string;
  n: number;
  label: string;
  /** Speaker notes (decks); empty for a sheet. */
  notes: string;
  /** The page's own HTML as stored: the `<section>` or the `<article class="sheet">`. */
  html: string;
  /** Served URL of the last verify's screenshot of this page, when it took one. */
  image?: string;
};

export function isDeliverableKind(kind: string): kind is DeliverableKind {
  return kind === 'deck' || kind === 'document';
}

/**
 * The logical size a page renders at before it is scaled to its box.
 * @param kind
 */
export function pageSize(kind: DeliverableKind): { width: number; height: number } {
  return kind === 'deck' ? { width: SLIDE_WIDTH, height: SLIDE_HEIGHT } : { width: SHEET_WIDTH, height: SHEET_HEIGHT_GUESS };
}

/** reveal.js's transitions; anything else a slide names falls back to the deck's default (present mode's fade). */
const TRANSITION = /^(?:none|fade|slide|convex|concave|zoom)(?:-in)?(?: (?:none|fade|slide|convex|concave|zoom)-out)?$/;
const SPEED = new Set(['default', 'fast', 'slow']);

/**
 * The transition a slide's `<section>` asks for (`data-transition`, plus
 * `data-transition-speed`), when it is one reveal.js knows.
 * @param html - The slide as stored.
 */
export function slideTransition(html: string): { transition?: string; speed?: string } {
  const open = /^\s*<section\b[^>]*>/i.exec(html)?.[0] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(open)?.slice(1).find(v => v !== undefined)?.trim().toLowerCase();
  const transition = attr('data-transition');
  const speed = attr('data-transition-speed');
  return { ...(transition && TRANSITION.test(transition) ? { transition } : {}), ...(speed && SPEED.has(speed) ? { speed } : {}) };
}

/**
 * The pages, in order.
 * @param kind - Deck or document.
 * @param spec - The artifact's spec (a partial one renders as no pages).
 */
export function deliverablePages(kind: DeliverableKind, spec: Record<string, unknown>): DeliverablePage[] {
  if (kind === 'deck') {
    const deck = spec as Partial<DeckSpec>;
    const shots = new Map((deck.verification?.slides ?? []).map(s => [s.id, s.image]));
    return (deck.order ?? []).map((id, i) => {
      const html = deck.slides?.[id] ?? '';
      const t = slideText(html);
      const image = shots.get(id);
      return { key: id, n: i + 1, label: t.label, notes: t.notes, html, ...(image ? { image: artifactHref(image) } : {}) };
    });
  }
  const doc = spec as Partial<DocumentSpec>;
  const shots = new Map((doc.verification?.sheets ?? []).map(s => [s.n, s.image]));
  return parseSheets(stripDocumentChrome(doc.html ?? '')).sheets.map((s) => {
    const image = shots.get(s.n);
    return { key: String(s.n), n: s.n, label: s.label, notes: '', html: s.html, ...(image ? { image: artifactHref(image) } : {}) };
  });
}

/**
 * The HTML that renders one page alone: the deck's render page with just
 * that slide (fonts, assets and Vocion's element runtime included), or the
 * document with every other sheet left out (its head and styles kept).
 * @param kind - Deck or document.
 * @param spec - The artifact's spec.
 * @param key - Which page.
 * @param assetUrl - Where a deck's `asset:<id>` resolves (a data URI once fetched, else its served URL).
 */
export function pageDocument(kind: DeliverableKind, spec: Record<string, unknown>, key: string, assetUrl?: (id: string) => string | null): string {
  if (kind === 'deck') {
    const deck = spec as Partial<DeckSpec>;
    const assets = deck.assets ?? {};
    return buildDeckPage(
      { title: deck.title ?? '', order: [key], slides: { [key]: normaliseSlideHtml(deck.slides?.[key] ?? '') }, faces: deck.faces },
      { gap: 0, backdrop: '#ffffff', assetUrl: assetUrl ?? (id => (assets[id] ? artifactHref(assets[id].url) : null)) },
    );
  }
  const parsed = parseSheets(stripDocumentChrome((spec as Partial<DocumentSpec>).html ?? ''));
  const sheet = parsed.sheets.find(s => String(s.n) === key);
  return assemble({ before: parsed.before, after: parsed.after, sheets: sheet ? [sheet] : [] });
}

/**
 * What the last verify and the buyer's read found on one page, in the
 * verify's order, buyer findings last. The page number a finding names is
 * the position at the time it was read — the receipt the pane shows is the
 * receipt the version carries.
 * @param kind - Deck or document.
 * @param spec - The artifact's spec.
 * @param page - The page.
 */
export function pageFindings(kind: DeliverableKind, spec: Record<string, unknown>, page: Pick<DeliverablePage, 'key' | 'n'>): PageFinding[] {
  const out: PageFinding[] = [];
  const redTeam = (spec as { redTeam?: DocumentRedTeam }).redTeam;
  if (kind === 'deck') {
    const audit = (spec as Partial<DeckSpec>).verification?.slides.find(s => s.id === page.key);
    if (audit) {
      if (audit.overflowPx > 0) {
        out.push({ kind: 'overflow', px: Math.round(audit.overflowPx) });
      }
      audit.clipped.forEach(what => out.push({ kind: 'clipped', what }));
      audit.smallText.forEach(what => out.push({ kind: 'small-text', what }));
      audit.belowFooter.forEach(what => out.push({ kind: 'below-footer', what }));
      audit.unknownElements.forEach(what => out.push({ kind: 'unknown', what }));
      audit.unresolvedAssets.forEach(what => out.push({ kind: 'asset', what }));
      audit.placeholders.forEach(what => out.push({ kind: 'placeholder', what }));
      if (!audit.hasNotes) {
        out.push({ kind: 'no-notes' });
      }
    }
  } else {
    const audit = (spec as Partial<DocumentSpec>).verification?.sheets.find(s => s.n === page.n);
    if (audit) {
      if (audit.overflowPx > 0) {
        out.push({ kind: 'overflow', px: Math.round(audit.overflowPx) });
      }
      audit.clipped.forEach(what => out.push({ kind: 'clipped', what }));
    }
  }
  for (const f of redTeam?.findings ?? []) {
    if (f.sheet === page.n) {
      out.push({ kind: 'buyer', severity: f.severity, finding: f.finding, fix: f.fix });
    }
  }
  return out;
}
