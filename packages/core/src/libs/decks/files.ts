/**
 * A deliverable as files — the editor-neutral shape of `deck_checkout` and
 * `deck_checkin` (`docs/decks.md`, "Out and back").
 *
 * A deck is `deck.json` (format, title, order, sections, faces, playbook, and
 * each asset's name, type and a short-lived download link) plus one
 * `slides/<id>.html` per slide. A document is `document.html`. Any assistant
 * that can read and write files can edit either; Vocion re-renders and
 * re-audits whatever comes back as a new version.
 *
 * Pure.
 */

import type { DeckAsset, DeckSpec } from '@/libs/cards/specs';
import { DECK_FORMAT } from '@/libs/cards/specs';

export const DOCUMENT_FILE = 'document.html';
export const DECK_FILE = 'deck.json';

/** What `deck.json` says about one asset on the way out. */
export type CheckoutAsset = { name?: string; contentType: string; bytes?: number; download?: string };

/**
 * A deck as files.
 * @param spec - The deck.
 * @param download - A short-lived download URL per asset id, when one could be minted.
 */
export function deckToFiles(spec: DeckSpec, download: (assetId: string, asset: DeckAsset) => string | null): Record<string, string> {
  const assets: Record<string, CheckoutAsset> = {};
  for (const [id, a] of Object.entries(spec.assets ?? {})) {
    const link = download(id, a);
    assets[id] = { ...(a.name ? { name: a.name } : {}), contentType: a.contentType, ...(a.bytes ? { bytes: a.bytes } : {}), ...(link ? { download: link } : {}) };
  }
  const index = {
    format: DECK_FORMAT,
    title: spec.title,
    order: spec.order,
    ...(spec.sections ? { sections: spec.sections } : {}),
    ...(spec.faces ? { faces: spec.faces } : {}),
    ...(spec.playbook ? { playbook: spec.playbook } : {}),
    ...(Object.keys(assets).length ? { assets } : {}),
  };
  const files: Record<string, string> = { [DECK_FILE]: `${JSON.stringify(index, null, 2)}\n` };
  for (const id of spec.order) {
    files[`slides/${id}.html`] = `${spec.slides[id] ?? ''}\n`;
  }
  return files;
}

export type FilesDeck = {
  title: string;
  order: string[];
  slides: Record<string, string>;
  sections?: DeckSpec['sections'];
  faces?: DeckSpec['faces'];
  playbook?: string;
  /** Asset ids `deck.json` lists — kept from the stored deck when they already exist there. */
  assetIds: string[];
  warnings: string[];
};

/**
 * Read a checked-in Vocion deck. `slides/<id>.html` files not in the order are
 * reported and left out; an order entry with no file is reported and dropped.
 * @param files - Path → text.
 */
export function filesToDeck(files: Record<string, string>): FilesDeck {
  const raw = files[DECK_FILE];
  if (typeof raw !== 'string') {
    throw new TypeError(`no ${DECK_FILE}`);
  }
  let index: Record<string, unknown>;
  try {
    index = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new TypeError(`${DECK_FILE} is not JSON: ${(err as Error).message}`);
  }
  const warnings: string[] = [];
  const order = Array.isArray(index.order) ? index.order.map(String) : [];
  const slides: Record<string, string> = {};
  const kept: string[] = [];
  for (const id of order) {
    const html = files[`slides/${id}.html`];
    if (typeof html !== 'string') {
      warnings.push(`${DECK_FILE} orders "${id}" but there is no slides/${id}.html; it was dropped.`);
      continue;
    }
    slides[id] = html.trim();
    kept.push(id);
  }
  for (const path of Object.keys(files)) {
    const m = /^slides\/([^/]+)\.html$/.exec(path);
    if (m && !order.includes(m[1]!)) {
      warnings.push(`${path} is not in ${DECK_FILE}'s order; it was left out.`);
    }
  }
  return {
    title: typeof index.title === 'string' && index.title.trim() ? index.title.trim() : 'Deck',
    order: kept,
    slides,
    ...(index.sections && typeof index.sections === 'object' ? { sections: index.sections as DeckSpec['sections'] } : {}),
    ...(index.faces && typeof index.faces === 'object' ? { faces: index.faces as DeckSpec['faces'] } : {}),
    ...(typeof index.playbook === 'string' ? { playbook: index.playbook } : {}),
    assetIds: index.assets && typeof index.assets === 'object' ? Object.keys(index.assets) : [],
    warnings,
  };
}
