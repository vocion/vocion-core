/**
 * A MOCKUP IS THE PRODUCT'S OWN UI, DRAWN — NEVER A DOCUMENT ABOUT IT.
 *
 * Request #224, 2026-09-29 16:30Z ("copy-link button on each library row"):
 * asked "can you add mocks/images to this request?", the designer wrote two
 * annotated HTML documents — callouts, an anatomy table, rule boxes — and the
 * feature page went on saying "Preview pending". Chris: *"the drawn image
 * looks like AI slop — it should just be the outcome design… it shouldn't
 * have so many labels and text"*, and then: *"we probably don't need actual
 * screenshots for the mocks/drawings. I just want the mocks to be actual UI
 * blocks/mocks… we actually had GREAT ones in other Features, I want it to
 * look like that. with maybe a little of UX overlay or hints. Not a written
 * doc, rastered."* The great ones (requests #124, #130 and their siblings,
 * 2026-09-25) are the product's own cards, rows, chips and buttons at real
 * size on a quiet 1440×900 canvas, rendered to an image.
 *
 * So a mockup has one shape, and this module is its contract (pure — the
 * tables are `services/factory/mockups.ts`). Each image is one STATE, drawn
 * one of two ways:
 *
 *   - as UI BLOCKS (`html`): the component itself — the row, the dialog, the
 *     toast — in the product's look, centred on the canvas. No screenshot is
 *     needed; a real screen, when there is one, is a reference for the look.
 *   - as CHANGES over the real screen (`changes`): the newest capture of the
 *     surface, chosen here and never by the model, with only the change laid
 *     over the region it lands on. That capture is then the BEFORE.
 *
 * Either way the image is UI and nothing else. The checks below refuse what
 * made #224 a document: captions and notes, arrows, paragraphs of prose,
 * tables, headings that explain the design, annotation classes. The one
 * overlay allowed is the platform's own: an element marked `data-hint="1"`
 * gets a highlight ring and a small numbered badge, and `data-note="…"` one
 * short line beside it (at most three) — a little UX exposition where the
 * picture cannot say it, drawn by the tool, never a written doc.
 */

import { shotParts } from '@/libs/workspace/criterionEvidence';

/** A rectangle on the base screenshot, in its own pixels. */
export type Region = { x: number; y: number; width: number; height: number };

/** One change laid over the screen: the UI that is new, where it lands. */
export type MockupChange = {
  region: Region;
  /** The new UI itself, as HTML — a button, a row, a toast. Never a note about it. */
  html: string;
  /** Styles for that HTML. */
  css?: string;
};

/**
 * One image: a state of the change (default, hover, copied) — the product's
 * UI blocks as `html`, or `changes` over the real screen. Exactly one.
 */
export type MockupState = {
  state: string;
  /**
   * The one line a person reads under the image — what it shows, in the
   * product's terms ("Remind a person who has not opened it"). Written by
   * whoever draws it, at filing; the carousel reads it and never makes one up.
   */
  caption?: string;
  html?: string;
  css?: string;
  changes?: MockupChange[];
};

/** The product's look, as the canvas and every block are drawn in it. */
export type MockupLook = { background: string; ink: string; accent: string; font: string; css?: string };

/**
 * THE LOOK WHEN NOTHING SAYS OTHERWISE — the 2026-09-25 mockups (#124 "Open
 * alerts", #131 "Find a document in your library"), which Chris named the
 * standard for every new feature on 2026-09-30: *"I love this style of
 * generated images in mocks for feature cards… that should be the standard
 * for all new features and mocks."* A quiet warm-grey desk (#ecebe8), the
 * product's own white window and phone on it, ink near black, and one blue
 * accent for the dashed NEW outline round what changes. A product with a
 * `look` of its own replaces any of these.
 */
export const DEFAULT_LOOK: MockupLook = { background: '#ecebe8', ink: '#1f2328', accent: '#2f5bd3', font: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' };

/** Canvas sizes: the desk the #124-era mockups were drawn at, and a phone. */
export const CANVAS: Record<'desktop' | 'mobile', { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 430, height: 932 },
};

/** An artifact as the base picker reads it. */
export type ShotCandidate = {
  id: number;
  title: string;
  kind: string;
  recordRole: string | null;
  url: string | null;
  spec: Record<string, unknown>;
  createdAt: Date;
};

/** The artifact roles that are captures of the running product. */
export const CAPTURE_ROLES: ReadonlySet<string> = new Set(['qa-screenshot', 'before-shot']);

/** The worker's own words for a capture that did not show the surface. */
const NOT_THE_SURFACE = /\(app error state\)|\bnot the state\b|\berror state\b/i;

const IMAGE_URL = /\.(?:png|jpe?g|webp|gif)(?:\?|$)/i;

/** The per-mockup limits. Small on purpose: a mockup is a change, not a page. */
export const MOCKUP_LIMITS = {
  states: 6,
  changesPerState: 4,
  htmlChars: 4_000,
  cssChars: 4_000,
  /** Words a person reads on a change over a screen: a label, a toast — never a paragraph. */
  textChars: 80,
  /** HTML for one state drawn as UI blocks. */
  blockHtmlChars: 12_000,
  /** The longest run of text a UI string is: a row title, a helper line. */
  runChars: 110,
  /** Every word on one image: a few rows and a dialog, not a page of prose. */
  blockTextChars: 700,
  /** Headings are the product's titles ("Send "Deck.pdf""), not design talk. */
  headingChars: 60,
  /** The platform's hint badges on one image. */
  hints: 3,
  /** Dashed NEW outlines on one image: the change, and at most one more place it shows. */
  news: 2,
  /** Short UX notes on one image, drawn beside the element they are about. */
  notes: 3,
  /** A note is one line. */
  noteWords: 15,
  /** Share of the screen one image may cover with new UI. */
  areaShare: 0.4,
} as const;

/**
 * Where a candidate keeps an image an `<img>` can load, or null.
 * @param a - The artifact.
 */
export function shotUrl(a: Pick<ShotCandidate, 'url' | 'spec'>): string | null {
  for (const u of [a.url, a.spec.url, a.spec.href]) {
    if (typeof u === 'string' && IMAGE_URL.test(u)) {
      return u;
    }
  }
  return null;
}

/**
 * Whether the capture says it missed the surface — the worker writes
 * "(app error state)" or "not the state: …" on a shot of the wrong screen.
 * @param a - The artifact.
 */
export function showsAnError(a: Pick<ShotCandidate, 'title' | 'spec'>): boolean {
  const words = [a.title, a.spec.description, a.spec.caption].filter((s): s is string => typeof s === 'string').join(' ');
  return NOT_THE_SURFACE.test(words);
}

export type BasePick
  = | { ok: true; shot: ShotCandidate; url: string; viewport: string | null }
    | { ok: false; reason: string };

/**
 * THE BASE: the newest real capture of the surface as it is today.
 *
 * A QA shot counts when its title's side is `before` (the worker names them
 * "<flow> · <viewport> · before"); a `before-shot` on the request counts as
 * it is. Desktop first unless a viewport is asked for, because that is the
 * shot the worker takes first and the one a phone reader zooms into.
 * @param candidates - Every artifact on the request and its tasks.
 * @param opts - Choices.
 * @param opts.viewport - "desktop" / "mobile", when the change is for one.
 * @param opts.baseId - An artifact the caller named; it must itself be a capture.
 */
export function pickBase(candidates: readonly ShotCandidate[], opts: { viewport?: string | null; baseId?: number | null } = {}): BasePick {
  const captures = candidates.filter((a) => {
    if (!a.recordRole || !CAPTURE_ROLES.has(a.recordRole) || shotUrl(a) === null) {
      return false;
    }
    return a.recordRole === 'before-shot' || shotParts(a.title).side === 'before';
  });
  if (opts.baseId) {
    const named = candidates.find(a => a.id === opts.baseId);
    if (!named || !named.recordRole || !CAPTURE_ROLES.has(named.recordRole) || shotUrl(named) === null) {
      return { ok: false, reason: `Artifact #${opts.baseId} is not a screenshot of the running product on this request or its tasks, so it cannot be the base. Leave base_artifact_id out and the newest real capture is used.` };
    }
    if (showsAnError(named)) {
      return { ok: false, reason: `Artifact #${opts.baseId} is a capture of an error state, not of the surface.` };
    }
    return { ok: true, shot: named, url: shotUrl(named)!, viewport: shotParts(named.title).viewport };
  }
  const usable = captures.filter(a => !showsAnError(a));
  if (usable.length === 0) {
    if (captures.length > 0) {
      return { ok: false, reason: `No screenshot shows this surface: all ${captures.length} "before" capture${captures.length === 1 ? '' : 's'} on this request's tasks show an error state (the QA flow's path is probably not the page the change lands on).` };
    }
    return { ok: false, reason: 'No screenshot of this surface exists: nothing on this request or its tasks is a capture of the running product.' };
  }
  const want = opts.viewport?.trim().toLowerCase() || 'desktop';
  const newest = (list: ShotCandidate[]) => [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)[0]!;
  const matching = usable.filter(a => (shotParts(a.title).viewport ?? '').toLowerCase() === want);
  const shot = newest(matching.length > 0 ? matching : usable);
  return { ok: true, shot, url: shotUrl(shot)!, viewport: shotParts(shot.title).viewport };
}

/**
 * The words a person would read on the change, tags and styles removed.
 * @param html - The change's HTML.
 */
export function visibleText(html: string): string {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, 'x')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that explain a mockup rather than being part of the product: the
 * captions ("AFTER:", "Note —"), callouts and arrows #224's documents were
 * made of. A product's own words ("Expires after 7 days", "Add a note")
 * pass; a caption does not.
 */
const ANNOTATION = /\b(?:mock-?ups?|annotations?|callouts?|placeholder|lorem ipsum|anatomy|rationale|design notes?|acceptance criteri(?:a|on))\b|(?:^|\s)(?:before|after|proposed|note|rule|todo|why|how it works)\s*[:—–]|[→←↑↓⟶⟵➜➔]/i;

/** A heading that talks about the design instead of being the product's title. */
const DESIGN_TALK = /\b(?:states?|placement|behaviou?r|interaction|layout|variants?|option [a-z0-9]|recommend(?:ed|ation)?|what changes|the change|this (?:screen|design|control))\b/i;

/** Markup a plain UI fragment never needs. */
const FORBIDDEN_MARKUP = /<\s*(?:script|iframe|object|embed|link|meta|base|form)\b|\bon[a-z]+\s*=|javascript:|@import|url\(\s*['"]?(?!data:)/i;

/** The furniture of a written document: tables, captions, quotes, code. */
const DOCUMENT_MARKUP = /<\s*(?:table|thead|tbody|tr|td|th|figcaption|caption|blockquote|pre|article|legend)\b/i;

/** A class or id that names an annotation rather than a piece of UI. */
const ANNOTATION_CLASS = /\b(?:class|id)\s*=\s*["'][^"']*\b(?:callouts?|annotations?|anatomy|notes?|legend|captions?|rules?|spec|redline|explainer|sticky)\b/i;

/**
 * The runs of text a person would read, one per text node.
 * @param html - The UI's HTML.
 */
export function textRuns(html: string): string[] {
  return html
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '<>')
    .split(/<[^>]*>/)
    .map(t => t.replace(/&nbsp;/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, 'x').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Why this HTML is not plain UI, or nothing. The same rule for every image,
 * drawn on a screenshot or not: UI text only — button labels, row titles, a
 * toast's words — never a note, a table, a heading about the design, or prose.
 * @param html - The UI's HTML.
 * @param css - Its styles.
 * @param where - Which state and change, for the message.
 * @param limit - The most words the image may carry.
 */
function uiProblems(html: string, css: string, where: string, limit: number): string[] {
  const out: string[] = [];
  if (FORBIDDEN_MARKUP.test(html) || FORBIDDEN_MARKUP.test(css)) {
    out.push(`${where}: plain HTML and CSS only — no scripts, handlers, embeds, links or outside URLs.`);
  }
  if (DOCUMENT_MARKUP.test(html)) {
    out.push(`${where}: a table, caption, quote or code block is a document, not UI. Draw the product's own rows and cards.`);
  }
  if (ANNOTATION_CLASS.test(html)) {
    out.push(`${where}: an element is classed as an annotation (callout, note, legend, rule…). Draw the UI only; mark the changed element with data-hint="1", and put a short note in data-note="…" — the platform draws both.`);
  }
  for (const m of html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    const heading = visibleText(m[1] ?? '');
    if (heading.length > MOCKUP_LIMITS.headingChars || DESIGN_TALK.test(heading) || ANNOTATION.test(heading)) {
      out.push(`${where}: the heading "${heading.slice(0, 60)}" explains the design. A heading on a mockup is the product's own title, or nothing.`);
    }
  }
  const runs = textRuns(html);
  const long = runs.find(r => r.length > MOCKUP_LIMITS.runChars);
  if (long) {
    out.push(`${where}: "${long.slice(0, 50)}…" is a paragraph (${long.length} characters). UI text is a label, a row, a toast — at most ${MOCKUP_LIMITS.runChars} characters a line.`);
  }
  const total = runs.join(' ').length;
  if (total > limit) {
    out.push(`${where}: ${total} characters of text. The image is UI a person would see, not an explanation of it (at most ${limit}).`);
  }
  const hit = ANNOTATION.exec(runs.join(' \n '));
  if (hit) {
    out.push(`${where}: "${hit[0].trim()}" is a note about the design, not part of the product. Draw the UI only: no labels, captions, arrows or rules on the image.`);
  }
  const hints = [...html.matchAll(/\bdata-hint\s*=\s*["']?([^"'\s>]*)/gi)].map(h => h[1] ?? '');
  if (hints.some(h => !/^[1-9]$/.test(h))) {
    out.push(`${where}: data-hint takes one digit, 1–9 — the badge's number; a word of explanation goes in data-note.`);
  }
  if (hints.length > MOCKUP_LIMITS.hints) {
    out.push(`${where}: ${hints.length} hints; at most ${MOCKUP_LIMITS.hints}. Mark only what changed.`);
  }
  const news = [...html.matchAll(/\bdata-new\b/gi)].length;
  if (news > MOCKUP_LIMITS.news) {
    out.push(`${where}: ${news} elements marked data-new; at most ${MOCKUP_LIMITS.news}. The NEW outline goes round the change itself.`);
  }
  out.push(...noteProblems(html, runs, where));
  return out;
}

/**
 * THE NOTES a mockup may carry: a little UX exposition where the picture
 * cannot say it — "Copies the share link, never opens the file" — and no
 * more. Chris, 2026-09-29: *"there can be some UX exposition where needed.
 * just not a ton. minimal where it adds clarification and direction not
 * evident in the mockup."* So a note is an attribute on the element it is
 * about (`data-note`), drawn by the platform as one line beside a ring: at
 * most three, fifteen words each, and never the words already on the screen.
 * @param html - The UI's HTML.
 * @param runs - Its visible text.
 * @param where - Which state, for the message.
 */
function noteProblems(html: string, runs: readonly string[], where: string): string[] {
  const out: string[] = [];
  const notes = [...html.matchAll(/\bdata-note\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim());
  if (notes.length > MOCKUP_LIMITS.notes) {
    out.push(`${where}: ${notes.length} notes; at most ${MOCKUP_LIMITS.notes}. A note is for what the picture cannot show — the rest belongs on the request.`);
  }
  const screen = runs.map(r => r.toLowerCase());
  for (const n of notes) {
    const words = n.split(' ').filter(Boolean).length;
    if (n === '' || words > MOCKUP_LIMITS.noteWords || n.length > MOCKUP_LIMITS.runChars) {
      out.push(`${where}: the note "${n.slice(0, 50)}${n.length > 50 ? '…' : ''}" is ${n === '' ? 'empty' : `${words} words`}; a note is one line of at most ${MOCKUP_LIMITS.noteWords} words.`);
      continue;
    }
    const said = n.toLowerCase().replace(/[.!]$/, '');
    if (screen.some(r => r === said || (said.length >= 8 && r.includes(said)))) {
      out.push(`${where}: the note "${n}" says what the screen already shows. Keep a note for what the picture cannot say, or leave it out.`);
    }
  }
  return out;
}

/**
 * Why these states cannot be drawn as plain UI, or an empty list. Every
 * reason is one the model can act on.
 * @param states - What the caller asked to draw.
 * @param size - The base screenshot, in pixels, when there is one.
 * @param size.width - Its width.
 * @param size.height - Its height.
 */
export function mockupProblems(states: readonly MockupState[], size: { width: number; height: number } | null): string[] {
  const out: string[] = [];
  if (states.length === 0) {
    return ['Draw at least one state.'];
  }
  if (states.length > MOCKUP_LIMITS.states) {
    out.push(`At most ${MOCKUP_LIMITS.states} images in one call; you sent ${states.length}.`);
  }
  const names = new Set<string>();
  for (const [i, s] of states.entries()) {
    const at = `mockups[${i}] ("${s.state}")`;
    const key = s.state.trim().toLowerCase();
    if (names.has(key)) {
      out.push(`${at}: two images are named "${s.state}"; name each state once.`);
    }
    names.add(key);
    const changes = s.changes ?? [];
    const html = s.html?.trim() ?? '';
    if ((html === '') === (changes.length === 0)) {
      out.push(`${at}: give the state either \`html\` (the product's UI blocks) or \`changes\` (over the real screen), not ${html === '' ? 'neither' : 'both'}.`);
      continue;
    }
    if (html !== '') {
      if (html.length > MOCKUP_LIMITS.blockHtmlChars || (s.css?.length ?? 0) > MOCKUP_LIMITS.cssChars * 2) {
        out.push(`${at}: the UI is larger than a mockup (${MOCKUP_LIMITS.blockHtmlChars} characters of HTML at most). Draw the component and its neighbours, not the whole app.`);
      }
      out.push(...uiProblems(html, s.css ?? '', at, MOCKUP_LIMITS.blockTextChars));
      continue;
    }
    if (!size) {
      out.push(`${at}: there is no screenshot of this surface to lay changes over. Draw the state as the product's UI blocks in \`html\` instead.`);
      continue;
    }
    if (changes.length > MOCKUP_LIMITS.changesPerState) {
      out.push(`${at}: 1 to ${MOCKUP_LIMITS.changesPerState} changes per image; this has ${changes.length}.`);
    }
    let area = 0;
    for (const [j, c] of changes.entries()) {
      const where = `${at}.changes[${j}]`;
      const r = c.region;
      if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > size.width || r.y + r.height > size.height) {
        out.push(`${where}: region ${r.x},${r.y} ${r.width}×${r.height} is not inside the ${size.width}×${size.height} screenshot.`);
      }
      area += Math.max(0, r.width) * Math.max(0, r.height);
      if (c.html.length > MOCKUP_LIMITS.htmlChars || (c.css?.length ?? 0) > MOCKUP_LIMITS.cssChars) {
        out.push(`${where}: the change is larger than a change (${MOCKUP_LIMITS.htmlChars} characters of HTML and of CSS at most).`);
      }
      out.push(...uiProblems(c.html, c.css ?? '', where, MOCKUP_LIMITS.textChars));
    }
    if (area > MOCKUP_LIMITS.areaShare * size.width * size.height) {
      out.push(`${at}: the changes cover ${Math.round((100 * area) / (size.width * size.height))}% of the screen. Draw only what changes, where it lands (at most ${Math.round(MOCKUP_LIMITS.areaShare * 100)}%), or draw the state as UI blocks in \`html\`.`);
    }
  }
  return out;
}

/**
 * The one overlay a mockup carries, drawn by the platform: the dashed accent
 * outline with a NEW pill round an element marked `data-new` (the change, as
 * the 09-25 mockups marked it), a ring round an element marked `data-hint`
 * with a small badge carrying its number, and a note beside `data-note`.
 * @param accent - The ring and badge colour.
 * @param font - The badge's font.
 */
function hintCss(accent: string, font: string): string {
  return `[data-hint],[data-note]{position:relative;outline:2px solid ${accent};outline-offset:4px}[data-hint]::after{content:attr(data-hint);position:absolute;top:-15px;right:-15px;width:22px;height:22px;border-radius:999px;background:${accent};color:#fff;font:700 12px/22px ${font};text-align:center;box-shadow:0 1px 3px rgba(15,23,42,.25);z-index:10}[data-note]::before{content:attr(data-note);position:absolute;top:calc(100% + 12px);left:0;width:max-content;max-width:280px;padding:5px 9px;border-radius:8px;background:#0f172a;color:#fff;font:500 12px/1.35 ${font};letter-spacing:0;text-transform:none;white-space:normal;box-shadow:0 4px 12px rgba(15,23,42,.18);z-index:10}[data-new]{position:relative;outline:1.5px dashed ${accent};outline-offset:6px}[data-new]::after{content:'NEW';position:absolute;top:-15px;right:-4px;padding:2px 7px;border-radius:999px;background:${accent};color:#fff;font:700 9px/12px ${font};letter-spacing:.06em;z-index:10}`;
}

/**
 * A CSS value from a look, with anything that could close the style block removed.
 * @param v
 */
function token(v: string): string {
  return v.replace(/[<>{};]/g, '').slice(0, 200);
}

/**
 * The page the renderer photographs: the screenshot at its own size, and each
 * change positioned over it. Nothing else — no frame, no caption, no title.
 * @param baseDataUri - The screenshot as a data URI.
 * @param size - Its pixel size.
 * @param size.width - Width.
 * @param size.height - Height.
 * @param changes - What is laid over it.
 * @param look - The product's look, for the hint colour.
 */
export function mockupHtml(baseDataUri: string, size: { width: number; height: number }, changes: readonly MockupChange[], look: MockupLook = DEFAULT_LOOK): string {
  const layers = changes.map((c, i) => {
    const r = c.region;
    return `<div class="vc-change vc-change-${i}" style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;overflow:visible">${c.html}</div>`;
  }).join('');
  const css = changes.map(c => c.css ?? '').join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}#vc-screen{position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden}#vc-base{position:absolute;inset:0;width:${size.width}px;height:${size.height}px;display:block}.vc-change{box-sizing:border-box}${hintCss(token(look.accent), token(look.font))}${css}</style></head><body><div id="vc-screen"><img id="vc-base" src="${baseDataUri}" alt="">${layers}</div></body></html>`;
}

/**
 * THE PRODUCT CHROME every UI-blocks mockup may draw in — the frames the
 * 09-25 mockups were made of, so a designer draws the change and not a
 * browser. Each is a class on plain HTML:
 *
 *   - `vc-window` — the product's own white window on the desk, with a
 *     `vc-bar` across its top (the product's mark, its nav, a primary
 *     button) and a `vc-body` under it.
 *   - `vc-phone` — a phone, its screen a `vc-display`, for the same change
 *     on a phone or a second state beside the desk.
 *   - `vc-panel` — a side panel or sheet opening beside the window.
 *   - `vc-card`, `vc-row`, `vc-chip`, `vc-btn` (and `vc-btn-quiet`),
 *     `vc-muted`, `vc-toggle` (`vc-on`) — the pieces inside them.
 *
 * Put the change inside with `data-new` — the dashed accent outline and NEW
 * pill — and the platform draws the rest.
 */
export const MOCKUP_KIT_CLASSES = ['vc-window', 'vc-bar', 'vc-body', 'vc-phone', 'vc-display', 'vc-panel', 'vc-card', 'vc-row', 'vc-chip', 'vc-btn', 'vc-btn-quiet', 'vc-muted', 'vc-toggle', 'vc-on'] as const;

/**
 * The chrome's styles, in a look.
 * @param look - The product's look.
 */
function kitCss(look: MockupLook): string {
  const ink = token(look.ink);
  const accent = token(look.accent);
  return [
    `.vc-window{background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 14px 36px rgba(15,23,42,.10);min-width:0;flex:0 1 auto}`,
    `.vc-bar{display:flex;align-items:center;gap:14px;height:44px;padding:0 16px;border-bottom:1px solid #ebeae6;font-size:12px;color:#6b6f76}`,
    `.vc-bar b,.vc-bar strong{color:${ink};font-size:13px}`,
    `.vc-body{padding:20px 22px;display:flex;flex-direction:column;gap:10px}`,
    `.vc-phone{flex:none;width:300px;height:640px;border-radius:48px;background:#15171c;padding:11px;box-shadow:0 22px 48px rgba(15,23,42,.24)}`,
    `.vc-display{width:100%;height:100%;border-radius:38px;background:#f7f7f5;overflow:hidden;padding:46px 16px 16px;display:flex;flex-direction:column;gap:10px}`,
    `.vc-panel{flex:none;width:360px;background:#fff;border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 14px 36px rgba(15,23,42,.10);padding:18px 20px;display:flex;flex-direction:column;gap:10px}`,
    `.vc-card{background:#fff;border:1px solid #e7e5e0;border-radius:10px;padding:12px 14px}`,
    `.vc-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #ebeae6;border-radius:8px;background:#fff}`,
    `.vc-chip{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:6px;border:1px solid #e2e0da;font-size:11px;font-weight:600;color:${ink};background:#fff}`,
    `.vc-btn{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:7px;border:0;background:${accent};color:#fff;font-family:inherit;font-size:12px;font-weight:600;line-height:1}`,
    `.vc-btn-quiet{background:#fff;color:${ink};border:1px solid #dedcd6}`,
    `.vc-muted{color:#6b6f76;font-size:12px}`,
    `.vc-toggle{flex:none;width:30px;height:18px;border-radius:999px;background:#d9d7d1;position:relative}`,
    `.vc-toggle::before{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.2)}`,
    `.vc-toggle.vc-on{background:${accent}}`,
    `.vc-toggle.vc-on::before{left:14px}`,
  ].join('');
}

/**
 * The page for a state drawn as UI blocks: the product's components centred
 * on a quiet canvas the size of a desk or a phone, in the product's look.
 * This is the shape of the #124-era mockups — a window and a phone side by
 * side, a card, a dialog, a row of chips — and nothing else is on the canvas.
 * The product chrome (`MOCKUP_KIT_CLASSES`) is always available; a product's
 * own `look.css` comes after it, so it wins.
 * @param state - The state's HTML and CSS.
 * @param state.html - The UI blocks.
 * @param state.css - Their styles.
 * @param look - The product's look.
 * @param viewport - Desk or phone.
 */
export function blocksHtml(state: { html: string; css?: string }, look: MockupLook = DEFAULT_LOOK, viewport: 'desktop' | 'mobile' = 'desktop'): string {
  const { width, height } = CANVAS[viewport];
  const font = token(look.font);
  const pad = viewport === 'mobile' ? 20 : 48;
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:${token(look.background)}}#vc-screen{width:${width}px;height:${height}px;overflow:hidden;display:flex;flex-direction:${viewport === 'mobile' ? 'column' : 'row'};align-items:center;justify-content:center;gap:${viewport === 'mobile' ? 20 : 48}px;padding:${pad}px;background:${token(look.background)};color:${token(look.ink)};font-family:${font};font-size:14px;line-height:1.4}${kitCss(look)}${hintCss(token(look.accent), font)}${look.css ?? ''}${state.css ?? ''}</style></head><body><div id="vc-screen">${state.html}</div></body></html>`;
}

/** The `visuals` keys only the mockup tool writes. */
export const TOOL_OWNED_VISUAL_KEYS = ['beforeArtifactIds', 'mockupArtifactIds'] as const;

function bag(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameIds(a: unknown, b: unknown): boolean {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(Number) : []);
  const x = list(a);
  const y = list(b);
  return x.length === y.length && x.every((n, i) => n === y[i]);
}

/**
 * A hand-written `visuals` checked against the ids only the tool may write,
 * and completed from the record: keys the write left out are carried over,
 * so setting `surfaceUrl` never drops the mockups, and an id list that
 * differs from the record's is refused.
 * @param current - The record's `visuals` now.
 * @param next - The `visuals` the write sends.
 * @returns The value to write, or why not.
 */
export function guardVisuals(current: unknown, next: unknown): { ok: true; value: Record<string, unknown> | null } | { ok: false; reason: string } {
  if (next === null) {
    const had = TOOL_OWNED_VISUAL_KEYS.filter(k => Array.isArray(bag(current)[k]) && (bag(current)[k] as unknown[]).length > 0);
    return had.length > 0
      ? { ok: false, reason: `visuals carries ${had.join(' and ')}, which only draw_mockup writes; clear the fields you mean one by one.` }
      : { ok: true, value: null };
  }
  const was = bag(current);
  const want = bag(next);
  const changed = TOOL_OWNED_VISUAL_KEYS.filter(k => k in want && !sameIds(want[k], was[k]));
  if (changed.length > 0) {
    return { ok: false, reason: `visuals.${changed.join(' and visuals.')} ${changed.length === 1 ? 'is' : 'are'} written by draw_mockup, never by hand: it puts the real screenshot on beforeArtifactIds and the drawn states on mockupArtifactIds. Call draw_mockup with the request id and the change instead.` };
  }
  const value: Record<string, unknown> = { ...want };
  for (const [k, v] of Object.entries(was)) {
    if (!(k in value)) {
      value[k] = v;
    }
  }
  return { ok: true, value };
}

/**
 * The `visuals` the tool writes: this call's images as the mockups, the
 * screenshot as the before only when one was drawn on, everything else as
 * the record had it. A blank or stale `noVisualReason` is dropped — there is
 * a visual now — and so is `mockupDraw`, the default draw's progress
 * (`libs/factory/mockupDefault.ts`): the mockup it was waiting for is here. Without a screenshot, `beforeArtifactIds` keeps only ids that
 * are captures of the product (`captureIds`): a document someone typed there
 * is not the screen today.
 * @param current - The record's `visuals` now.
 * @param ids - What was drawn.
 * @param ids.beforeId - The screenshot drawn on, or null.
 * @param ids.mockupIds - The drawn states, in order.
 * @param ids.captureIds - Artifact ids known to be captures of the product.
 */
export function mockupVisuals(current: unknown, ids: { beforeId: number | null; mockupIds: number[]; captureIds?: ReadonlySet<number> }): Record<string, unknown> {
  const { noVisualReason: _dropped, mockupDraw: _drawn, beforeArtifactIds, ...rest } = bag(current);
  const kept = ids.beforeId !== null
    ? [ids.beforeId]
    : (Array.isArray(beforeArtifactIds) ? beforeArtifactIds.map(Number) : []).filter(id => ids.captureIds?.has(id) === true);
  return { ...rest, ...(kept.length > 0 ? { beforeArtifactIds: kept } : {}), mockupArtifactIds: ids.mockupIds };
}

/** The artifact role every drawn mockup is filed under, as #124's were. */
export const MOCKUP_ROLE = 'mockup';

/**
 * A drawn state's title: "Mockup: <request>" for one image, with the state
 * after it when there are several — the name a redraw is matched on, so
 * drawing "Link copied" again is a new version of the same artifact.
 * @param requestTitle - The request.
 * @param state - The state.
 * @param count - How many states this call drew.
 */
export function mockupTitle(requestTitle: string, state: string, count: number): string {
  return count > 1 ? `Mockup: ${requestTitle} · ${state.trim()}` : `Mockup: ${requestTitle}`;
}
