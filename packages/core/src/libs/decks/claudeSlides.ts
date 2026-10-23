/**
 * The Claude Slides adapter — the whole of it.
 *
 * A Claude Slides v4 project is `project/deck.json` (title, order, sections,
 * faces), one `project/slides/<id>.html` per slide (a `<section id>`), and
 * images referenced as `/_blob/<hex>`. `vocion-deck/1` was drawn close to
 * that layout on purpose, so converting is renaming: the files become a
 * spec, and every blob reference becomes an `asset:blob-<hex>` whose bytes
 * the caller stores (or reports as unresolved). The reverse is the same walk
 * backwards, for checking a deck out to someone who edits in Claude.
 *
 * Optional, thin, and nothing else may depend on it: no part of Vocion loads
 * another product's runtime, and the deck renders without this file.
 *
 * Pure.
 */

import type { DeckSpec } from '@/libs/cards/specs';
import { DECK_FORMAT, DECK_SLIDE_ID } from '@/libs/cards/specs';

/** `/_blob/<hex>` (optionally with an extension) in a src, href or url(). */
const BLOB_REF = /\/_blob\/([0-9a-f]{8,128})(?:\.[a-z0-9]{1,5})?/gi;

/**
 * The asset id a blob becomes.
 * @param hex - The blob's hex name.
 */
export function blobAssetId(hex: string): string {
  return `blob-${hex.toLowerCase().slice(0, 64)}`;
}

/**
 * Where the project's files sit: `project/` when present, else the root.
 * @param files - Path → text.
 */
function projectPrefix(files: Record<string, unknown>): string | null {
  const deck = Object.keys(files).find(p => /(?:^|\/)project\/deck\.json$/.test(p));
  if (deck) {
    return deck.slice(0, -'deck.json'.length);
  }
  return null;
}

/**
 * Whether a set of checked-in files is a Claude Slides project rather than a
 * Vocion deck: a `project/deck.json`, or a root `deck.json` that does not say
 * `vocion-deck/1`.
 * @param files - Path → text.
 */
export function isClaudeSlides(files: Record<string, string>): boolean {
  if (projectPrefix(files) !== null) {
    return true;
  }
  const root = files['deck.json'];
  if (typeof root !== 'string') {
    return false;
  }
  try {
    return (JSON.parse(root) as { format?: unknown }).format !== DECK_FORMAT;
  } catch {
    return false;
  }
}

type ClaudeDeckJson = {
  version?: number;
  title?: string;
  order?: unknown;
  sections?: unknown;
  faces?: unknown;
};

function asRecord<T>(value: unknown, keyOf: (v: Record<string, unknown>) => string | undefined): Record<string, T> {
  if (Array.isArray(value)) {
    const out: Record<string, T> = {};
    for (const v of value) {
      if (v && typeof v === 'object') {
        const k = keyOf(v as Record<string, unknown>);
        if (k) {
          out[k] = v as T;
        }
      }
    }
    return out;
  }
  return value && typeof value === 'object' ? (value as Record<string, T>) : {};
}

export type ClaudeImport = {
  spec: DeckSpec;
  /** Every blob the slides reference, by hex — the caller stores their bytes as `asset:blob-<hex>`. */
  blobs: string[];
  /** Problems with the files themselves (a slide file the order does not name, and the like). */
  warnings: string[];
};

/**
 * Convert a Claude Slides v4 project to `vocion-deck/1`. Assets are left out
 * of the spec: the caller adds `assets[blobAssetId(hex)]` for each blob it
 * could store, and the audit names the rest.
 * @param files - Path → text, as checked in.
 * @param fallbackTitle - When deck.json has none.
 */
export function claudeSlidesToDeck(files: Record<string, string>, fallbackTitle = 'Deck'): ClaudeImport {
  const prefix = projectPrefix(files) ?? '';
  const raw = files[`${prefix}deck.json`];
  if (typeof raw !== 'string') {
    throw new TypeError('no deck.json in the project');
  }
  let deck: ClaudeDeckJson;
  try {
    deck = JSON.parse(raw) as ClaudeDeckJson;
  } catch (err) {
    throw new TypeError(`deck.json is not JSON: ${(err as Error).message}`);
  }
  const slideFiles = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) {
    const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}slides/([^/]+)\\.html$`).exec(path);
    if (m) {
      slideFiles.set(m[1]!, text);
    }
  }
  const warnings: string[] = [];
  const order = Array.isArray(deck.order) ? deck.order.map(String) : [...slideFiles.keys()].sort();
  const slides: Record<string, string> = {};
  const blobs = new Set<string>();
  for (const id of order) {
    const html = slideFiles.get(id);
    if (html === undefined) {
      warnings.push(`deck.json orders "${id}" but there is no slides/${id}.html; it was left out.`);
      continue;
    }
    if (!DECK_SLIDE_ID.test(id)) {
      warnings.push(`slide id "${id}" is not a valid id (letters, digits, _ and -); it was left out.`);
      continue;
    }
    slides[id] = html.trim().replace(BLOB_REF, (_m, hex: string) => {
      blobs.add(hex.toLowerCase());
      return `asset:${blobAssetId(hex)}`;
    });
  }
  for (const id of slideFiles.keys()) {
    if (!order.includes(id)) {
      warnings.push(`slides/${id}.html is not in deck.json's order; it was left out.`);
    }
  }
  const kept = order.filter(id => slides[id] !== undefined);
  const sections = asRecord<{ description?: string; start?: string; id?: string }>(deck.sections, v => (typeof v.id === 'string' ? v.id : undefined));
  const faces = asRecord<{ family?: string; href?: string; name?: string }>(deck.faces, v => (typeof v.family === 'string' ? v.family : typeof v.name === 'string' ? v.name : undefined));
  const spec: DeckSpec = {
    format: DECK_FORMAT,
    title: (typeof deck.title === 'string' && deck.title.trim()) || fallbackTitle,
    order: kept,
    slides,
  };
  const sectionEntries = Object.entries(sections)
    .filter(([, s]) => typeof s.start === 'string' && kept.includes(s.start))
    .map(([k, s]) => [k, { description: String(s.description ?? k).slice(0, 400), start: s.start! }] as const);
  if (sectionEntries.length > 0) {
    spec.sections = Object.fromEntries(sectionEntries);
  }
  const faceEntries = Object.entries(faces)
    .filter(([, f]) => typeof f.href === 'string' && /^https:\/\/fonts\.googleapis\.com\/css2\?/.test(f.href))
    .map(([k, f]) => [k, { family: String(f.family ?? f.name ?? k), href: f.href! }] as const);
  if (faceEntries.length > 0) {
    spec.faces = Object.fromEntries(faceEntries);
  }
  return { spec, blobs: [...blobs], warnings };
}

/**
 * A deck as a Claude Slides v4 project. `blobFor` names the blob an asset
 * becomes (its content hash); the caller ships the bytes beside the files as
 * `project/_blob/<hex>`. An asset with no blob stays `asset:<id>`.
 *
 * Vocion's own elements (`x-icon`, `x-shape`, `x-connector`) go out as
 * written: they come back intact, and an editor that does not draw them is
 * the editor's limit, not a loss in the deck.
 * @param spec - The deck.
 * @param blobFor - Asset id → hex, for the assets that have bytes.
 */
export function deckToClaudeSlides(spec: DeckSpec, blobFor: (assetId: string) => string | null): Record<string, string> {
  const files: Record<string, string> = {};
  const deck = {
    version: 4,
    title: spec.title,
    order: spec.order,
    ...(spec.sections ? { sections: spec.sections } : {}),
    ...(spec.faces ? { faces: spec.faces } : {}),
  };
  files['project/deck.json'] = `${JSON.stringify(deck, null, 2)}\n`;
  for (const id of spec.order) {
    files[`project/slides/${id}.html`] = (spec.slides[id] ?? '').replace(/asset:([\w.-]{1,80})/g, (whole, assetId: string) => {
      const hex = blobFor(assetId);
      return hex ? `/_blob/${hex}` : whole;
    });
  }
  return files;
}
