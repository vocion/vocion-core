/**
 * One slide of a `vocion-deck/1` deck: parse, validate, read.
 *
 * A slide is exactly one `<section id="<id>">` on a 1920×1080 canvas, styled
 * inline, with its speaker notes as plain text in one trailing `<aside>`
 * (`docs/decks.md`). This module is the static half of the audit — what can
 * be known from the markup alone: whether it is a slide at all (structure
 * errors refuse the write, with a message the author can act on), which
 * elements are outside the contract (an audit failure that names them, never
 * a refusal), its visible text and notes (what the red team and the diff
 * read), its placeholders and its asset references.
 *
 * Pure; no browser. The rendered half is `audit.ts`.
 */

import { load } from 'cheerio';
import { resolveIcon } from './icons';

/** The contract's elements, plus the ones an HTML parser inserts on its own (`tbody`) and the obvious synonyms (`strong`, `em`). */
export const SLIDE_ELEMENTS: ReadonlySet<string> = new Set([
  'section',
  'h1',
  'h2',
  'h3',
  'p',
  'ul',
  'ol',
  'li',
  'br',
  'b',
  'i',
  'u',
  'a',
  'span',
  'div',
  'img',
  'table',
  'tr',
  'th',
  'td',
  'svg',
  'hr',
  'aside',
  'x-icon',
  'x-shape',
  'x-connector',
  // Inserted by every HTML parser around table rows, or plain synonyms.
  'thead',
  'tbody',
  'tfoot',
  'strong',
  'em',
  'sup',
  'sub',
]);

/** What may appear inside an `<svg>`. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'marker',
  'title',
  'desc',
  'use',
  'symbol',
  'pattern',
  'foreignobject',
]);

/** Never in a slide: they run code, pull in outside styles or take input. A slide carrying one is refused. */
const FORBIDDEN = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'template', 'noscript']);

export const SHAPE_KINDS: ReadonlySet<string> = new Set(['rect', 'rounded', 'ellipse', 'diamond', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'line']);

export const MAX_SLIDE_ELEMENTS = 200;
export const MAX_NOTES_CHARS = 4_000;

/**
 * `<x-icon name="Lock"/>` → `<x-icon name="Lock"></x-icon>`. An HTML parser
 * reads a self-closed custom element as OPEN, and would swallow the rest of
 * the slide into the icon; every author writes them self-closed.
 * @param html - A slide as written.
 */
export function normaliseSlideHtml(html: string): string {
  return html.trim().replace(/<(x-(?:icon|shape|connector))\b([^<>]*?)\/>/gi, '<$1$2></$1>');
}

/** The slice of a parsed element this module reads (cheerio's node, without importing its parser's types). */
type Element = { type: string; name: string; attribs: Record<string, string> };

function fragment(html: string) {
  return load(normaliseSlideHtml(html), { xml: false }, false);
}

export type SlideCheck = {
  /** Structure problems: the slide is not written until they are fixed. */
  errors: string[];
  /** `element:<tag>`, `icon:<name>`, `shape:<kind>` — audit failures, named. */
  unknownElements: string[];
  /** Authored elements inside the section. */
  elementCount: number;
  notesLength: number;
};

/**
 * Check one slide against the contract.
 * @param id - Its key in `slides`.
 * @param html - Its HTML.
 */
export function checkSlide(id: string, html: string): SlideCheck {
  const errors: string[] = [];
  const unknown = new Set<string>();
  const $ = fragment(html);
  const top = ($.root().children().toArray() as unknown as Element[]).filter(n => n.type === 'tag' || n.type === 'script' || n.type === 'style');
  const strayText = $.root().contents().toArray().some(n => n.type === 'text' && (n as unknown as { data: string }).data.trim() !== '');
  if (top.length !== 1 || top[0]!.name !== 'section') {
    errors.push(`slide "${id}" must be exactly one <section id="${id}">…</section>; found ${top.length === 0 ? 'no element' : top.map(t => `<${t.name}>`).join(', ')}.`);
    return { errors, unknownElements: [], elementCount: 0, notesLength: 0 };
  }
  if (strayText) {
    errors.push(`slide "${id}" has text outside its <section>; everything goes inside the section.`);
  }
  const section = $(top[0] as never);
  const sid = section.attr('id');
  if (sid !== id) {
    errors.push(`slide "${id}": the <section> id is ${sid ? `"${sid}"` : 'missing'}; it must be id="${id}".`);
  }
  const all = section.find('*').toArray() as unknown as Element[];
  for (const el of [top[0]!, ...all]) {
    const tag = el.name.toLowerCase();
    if (FORBIDDEN.has(tag)) {
      errors.push(`slide "${id}": <${tag}> is not allowed in a slide (style inline on each element; no scripts, frames or form fields).`);
      continue;
    }
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      if (/^on/i.test(name)) {
        errors.push(`slide "${id}": the ${name} attribute on <${tag}> is not allowed (no scripts in a slide).`);
      } else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(value)) {
        errors.push(`slide "${id}": a javascript: URL on <${tag}> is not allowed.`);
      }
    }
    const inSvg = tag !== 'svg' && $(el as never).parents('svg').length > 0;
    if (inSvg ? !SVG_ELEMENTS.has(tag) : !SLIDE_ELEMENTS.has(tag)) {
      unknown.add(`element:${tag}`);
    }
    if (tag === 'x-icon' && !resolveIcon(el.attribs.name)) {
      unknown.add(`icon:${el.attribs.name ?? '(no name)'}`);
    }
    if (tag === 'x-shape' && !SHAPE_KINDS.has((el.attribs.kind ?? '').toLowerCase())) {
      unknown.add(`shape:${el.attribs.kind ?? '(no kind)'}`);
    }
    if (tag === 'x-connector') {
      const bad = ['x1', 'y1', 'x2', 'y2'].filter(k => !Number.isFinite(Number.parseFloat(el.attribs[k] ?? '')));
      if (bad.length > 0) {
        unknown.add(`connector:missing ${bad.join(' ')}`);
      }
    }
  }
  const asides = section.find('aside');
  let notesLength = 0;
  if (asides.length > 1) {
    errors.push(`slide "${id}" has ${asides.length} <aside> elements; speaker notes are one <aside>, the section's last child.`);
  } else if (asides.length === 1) {
    const aside = asides.first();
    const last = section.children().last();
    if ((aside.parent()[0] as unknown) !== top[0] || last[0] !== aside[0]) {
      errors.push(`slide "${id}": the notes <aside> must be the section's last child.`);
    }
    notesLength = aside.text().trim().length;
    if (notesLength > MAX_NOTES_CHARS) {
      errors.push(`slide "${id}": speaker notes are ${notesLength} characters; the limit is ${MAX_NOTES_CHARS}.`);
    }
  }
  return { errors, unknownElements: [...unknown].slice(0, 20), elementCount: all.length, notesLength };
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export type SlideText = {
  /** The visible text, one line, notes excluded. */
  text: string;
  /** The speaker notes, as written (whitespace collapsed). */
  notes: string;
  /** What the slide is known by: its first heading, else the start of its text. */
  label: string;
};

/**
 * What a reader sees and what the presenter says — the red team's input and
 * the diff's unit.
 * @param html - One slide.
 */
export function slideText(html: string): SlideText {
  const $ = fragment(html);
  const notes = squash($('aside').text());
  $('aside').remove();
  // Block elements end a word; without this "Title</h1><p>Body" reads "TitleBody".
  $('h1,h2,h3,p,li,div,td,th,tr,br,hr').each((_, el) => {
    $(el).append(' ');
  });
  const text = squash($.root().text());
  const heading = squash($('h1,h2,h3').first().text());
  return { text, notes, label: (heading || text).slice(0, 120) };
}

/**
 * Unresolved placeholders as written: `[$__]`, `[$__k]`, `[__]`, `[date]`,
 * `[TBD]`, `[CLIENT NAME]`, an empty `[ ]`. A format check on the author's own
 * tokens, the same convention the proposal skill writes.
 * @param text - Visible text.
 */
export function findPlaceholders(text: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /\[\s*(?:\$\s*)?_{2,}[^\]]{0,40}\]/g,
    /\[\s*(?:date|tbd|tbc|todo|x{2,}|n|x|name|amount|number|client|company|figure|metric)\s*\]/gi,
    /\[\s*(?:(?:\.{3}|…)\s*)?\]/g,
    /\[[A-Z][A-Z0-9 _/-]{2,40}\]/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      found.add(m[0]);
    }
  }
  return [...found].slice(0, 20);
}

export type AssetRefs = {
  /** `asset:<id>` references, by id. */
  ids: string[];
  /** `data:` URIs used as images — they fail the asset audit (assets are files). */
  dataUris: number;
  /** Remote or relative image URLs — they fail the asset audit. */
  other: string[];
};

/**
 * Every image reference in a slide: `src`, `href` on SVG `<image>`/`<use>`, and `url(…)` in inline styles.
 * @param html - One slide.
 */
export function assetRefs(html: string): AssetRefs {
  const refs: string[] = [];
  for (const m of html.matchAll(/\b(?:src|xlink:href)\s*=\s*["']([^"']+)["']/gi)) {
    refs.push(m[1]!.trim());
  }
  for (const m of html.matchAll(/url\((?:&quot;|["'])?([^"')&]+)/gi)) {
    refs.push(m[1]!.trim());
  }
  const ids = new Set<string>();
  const other = new Set<string>();
  let dataUris = 0;
  for (const r of refs) {
    if (r.startsWith('asset:')) {
      ids.add(r.slice('asset:'.length));
    } else if (r.startsWith('data:')) {
      dataUris++;
    } else if (!r.startsWith('#')) {
      other.add(r.slice(0, 200));
    }
  }
  return { ids: [...ids], dataUris, other: [...other] };
}

/**
 * Every `<x-icon name>` in a slide, as written.
 * @param html - One slide.
 */
export function iconNamesIn(html: string): string[] {
  return [...normaliseSlideHtml(html).matchAll(/<x-icon\s(?:[^>]*\s)?name\s*=\s*["']([^"']*)["']/gi)].map(m => m[1]!);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The slide with its notes replaced — or removed, for empty notes. Notes are
 * plain text; whatever markup was in them is gone.
 * @param html - One slide.
 * @param notes - The new speaker notes.
 */
export function withNotes(html: string, notes: string): string {
  const $ = fragment(html);
  const section = $('section').first();
  section.children('aside').remove();
  section.find('aside').remove();
  const text = notes.trim();
  if (text) {
    section.append(`<aside>${escapeHtml(text)}</aside>`);
  }
  return $.html();
}

/**
 * The slide id a section declares, or null when there is no single section.
 * @param html - A slide as written.
 */
export function sectionId(html: string): string | null {
  const $ = fragment(html);
  const top = $.root().children().toArray() as unknown as Element[];
  if (top.length !== 1 || top[0]!.name !== 'section') {
    return null;
  }
  return top[0]!.attribs.id ?? null;
}
