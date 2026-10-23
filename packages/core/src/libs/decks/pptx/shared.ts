/**
 * What the exporter writes and the importer reads back: object names, text
 * normalisation, hashes, and the per-slide marker.
 */

import { createHash } from 'node:crypto';

const NAME_RE = /^vocion:(.+):(\d+(?:\.\d+)*)(?:~(\w+))?$/;

/**
 * The name given to an exported object.
 * @param slideId - The slide the object is on.
 * @param path - Dotted child-index path from the slide's section.
 * @param suffix - Set for extra objects of the same element (`bg`, `raster`).
 */
export function objectName(slideId: string, path: string, suffix?: string): string {
  return `vocion:${slideId}:${path}${suffix ? `~${suffix}` : ''}`;
}

/**
 * Reads an object name back. Null when it is not one of ours.
 * @param name - The shape's name in the PPTX.
 */
export function parseObjectName(name: string): { slideId: string; path: string; suffix: string | null } | null {
  const m = NAME_RE.exec(name);
  return m ? { slideId: m[1]!, path: m[2]!, suffix: m[3] ?? null } : null;
}

/**
 * Whitespace-normal text: runs of spaces collapse, lines trim, trailing blank
 * lines go. This is the form that is hashed and compared on both sides.
 * @param s - Raw text; `\n` separates lines.
 */
export function normText(s: string): string {
  return s
    .split('\n')
    .map(l => l.replace(/[ \t\xA0\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

/**
 * Short stable hash of normalised text.
 * @param s - Text; normalised first.
 */
export function textHash(s: string): string {
  return createHash('sha1').update(normText(s)).digest('hex').slice(0, 8);
}

export type SlideMarker = {
  slideId: string;
  /** Hash of the notes the export wrote. */
  notes: string;
  /** Text objects: path to the hash of the text exported. */
  text: Record<string, string>;
  /** Every other object name the export wrote, so a deletion is noticed. */
  other: string[];
};

const MARKER_RE = /\[\[vocion:v1 ([^\]]*)\]\]/;

/**
 * The marker line, written at the end of the slide's notes.
 * @param m - What the export wrote for the slide.
 */
export function formatMarker(m: SlideMarker): string {
  const t = Object.entries(m.text).map(([p, h]) => `${p}:${h}`).join(',');
  return `[[vocion:v1 id=${encodeURIComponent(m.slideId)} n=${m.notes} t=${t} o=${m.other.join(',')}]]`;
}

/**
 * Finds the marker in a slide's notes and returns it with the notes text that
 * precedes it. Null marker when the notes carry none (stripped by an editor).
 * @param notes - The notes text of the slide in the PPTX.
 */
export function splitMarker(notes: string): { notes: string; marker: SlideMarker | null } {
  const m = MARKER_RE.exec(notes);
  if (!m) {
    return { notes: notes.trim(), marker: null };
  }
  const fields: Record<string, string> = {};
  for (const part of m[1]!.split(' ')) {
    const i = part.indexOf('=');
    if (i > 0) {
      fields[part.slice(0, i)] = part.slice(i + 1);
    }
  }
  const text: Record<string, string> = {};
  for (const pair of (fields.t ?? '').split(',').filter(Boolean)) {
    const [p, h] = pair.split(':');
    if (p && h) {
      text[p] = h;
    }
  }
  const before = notes.slice(0, m.index).trim();
  return {
    notes: before,
    marker: {
      slideId: decodeURIComponent(fields.id ?? ''),
      notes: fields.n ?? '',
      text,
      other: (fields.o ?? '').split(',').filter(Boolean),
    },
  };
}
