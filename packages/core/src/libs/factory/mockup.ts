/**
 * A MOCKUP IS THE REAL SCREEN WITH ONLY THE CHANGE DRAWN IN.
 *
 * Request #224, 2026-09-29 16:30Z ("copy-link button on each library row"):
 * asked "can you add mocks/images to this request?", the designer could not
 * read the app's source, so it wrote two annotated HTML documents from
 * memory — callouts, an anatomy table, rule boxes, a screen it invented — and
 * filed the AFTER under `beforeArtifactIds`. The feature page went on saying
 * "Preview pending". Chris: *"the drawn image looks like AI slop — it should
 * just be the outcome design, it shouldn't invent UX, it should be based off
 * the existing app. it shouldn't have so many labels and text."* Real
 * screenshots of that screen were already on the request's tasks.
 *
 * So a mockup has one shape, and this module is its contract (pure — the
 * tables are `services/factory/mockups.ts`):
 *
 *   - the BASE is a real screenshot of the surface, chosen here and never by
 *     the model: the newest QA "before" shot on the request's tasks, else a
 *     before-shot filed on the request. A shot the worker marked as an error
 *     state is not the surface, so it is skipped and counted.
 *   - the BEFORE is that screenshot, as it is. No redraw.
 *   - each AFTER is the same pixels with the change laid over the region it
 *     lands on — a control, a row, a toast — as plain UI. The checks below
 *     refuse what made #224 slop: text that explains instead of being the UI
 *     (labels, notes, BEFORE/AFTER captions, arrows), a change bigger than a
 *     change, and anything that reaches outside the screen.
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

/** One image: a state of the change (default, hover, copied). */
export type MockupState = { state: string; changes: MockupChange[] };

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
  /** Words a person reads on the change: a label, a toast — never a paragraph. */
  textChars: 80,
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
      return { ok: false, reason: `No screenshot shows this surface: all ${captures.length} "before" capture${captures.length === 1 ? '' : 's'} on this request's tasks show an error state, so the QA flow's path is probably not the page the change lands on. Nothing was drawn. Fix the flow's path on the task, or have QA capture the page, then draw again.` };
    }
    return { ok: false, reason: 'No screenshot of this surface exists yet: nothing on this request or its tasks is a capture of the running product. Nothing was drawn — a mockup starts from the real screen, never from memory. Say so in one line; the first QA run captures it.' };
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
const ANNOTATION = /\b(?:mock-?ups?|annotations?|callouts?|placeholder|lorem ipsum)\b|(?:^|\s)(?:before|after|proposed|note|rule|todo)\s*[:—–]|[→←↑↓⟶⟵➜➔]/i;

/** Markup a plain UI fragment never needs. */
const FORBIDDEN_MARKUP = /<\s*(?:script|iframe|object|embed|link|meta|base|form)\b|\bon[a-z]+\s*=|javascript:|@import|url\(\s*['"]?(?!data:)/i;

/**
 * Why these states cannot be drawn as plain UI on this screen, or an empty
 * list. Every reason is one the model can act on.
 * @param states - What the caller asked to draw.
 * @param size - The base screenshot, in pixels.
 * @param size.width - Its width.
 * @param size.height - Its height.
 */
export function mockupProblems(states: readonly MockupState[], size: { width: number; height: number }): string[] {
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
    if (s.changes.length === 0 || s.changes.length > MOCKUP_LIMITS.changesPerState) {
      out.push(`${at}: 1 to ${MOCKUP_LIMITS.changesPerState} changes per image; this has ${s.changes.length}.`);
    }
    let area = 0;
    for (const [j, c] of s.changes.entries()) {
      const where = `${at}.changes[${j}]`;
      const r = c.region;
      if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > size.width || r.y + r.height > size.height) {
        out.push(`${where}: region ${r.x},${r.y} ${r.width}×${r.height} is not inside the ${size.width}×${size.height} screenshot.`);
      }
      area += Math.max(0, r.width) * Math.max(0, r.height);
      if (c.html.length > MOCKUP_LIMITS.htmlChars || (c.css?.length ?? 0) > MOCKUP_LIMITS.cssChars) {
        out.push(`${where}: the change is larger than a change (${MOCKUP_LIMITS.htmlChars} characters of HTML and of CSS at most).`);
      }
      if (FORBIDDEN_MARKUP.test(c.html) || FORBIDDEN_MARKUP.test(c.css ?? '')) {
        out.push(`${where}: plain HTML and CSS only — no scripts, handlers, embeds, links or outside URLs.`);
      }
      const text = visibleText(c.html);
      if (text.length > MOCKUP_LIMITS.textChars) {
        out.push(`${where}: ${text.length} characters of text. The change is UI a person would see — a button label, a toast — not an explanation of it (at most ${MOCKUP_LIMITS.textChars}).`);
      }
      const hit = ANNOTATION.exec(text);
      if (hit) {
        out.push(`${where}: "${hit[0]}" is a note about the design, not part of the product. Draw the UI only: no labels, captions, arrows or rules on the image.`);
      }
    }
    if (area > MOCKUP_LIMITS.areaShare * size.width * size.height) {
      out.push(`${at}: the changes cover ${Math.round((100 * area) / (size.width * size.height))}% of the screen. Draw only what changes, where it lands (at most ${Math.round(MOCKUP_LIMITS.areaShare * 100)}%); the rest of the screen stays as it is.`);
    }
  }
  return out;
}

/**
 * The page the renderer photographs: the screenshot at its own size, and each
 * change positioned over it. Nothing else — no frame, no caption, no title.
 * @param baseDataUri - The screenshot as a data URI.
 * @param size - Its pixel size.
 * @param size.width - Width.
 * @param size.height - Height.
 * @param changes - What is laid over it.
 */
export function mockupHtml(baseDataUri: string, size: { width: number; height: number }, changes: readonly MockupChange[]): string {
  const layers = changes.map((c, i) => {
    const r = c.region;
    return `<div class="vc-change vc-change-${i}" style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;overflow:hidden">${c.html}</div>`;
  }).join('');
  const css = changes.map(c => c.css ?? '').join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}#vc-screen{position:relative;width:${size.width}px;height:${size.height}px;overflow:hidden}#vc-base{position:absolute;inset:0;width:${size.width}px;height:${size.height}px;display:block}.vc-change{box-sizing:border-box}${css}</style></head><body><div id="vc-screen"><img id="vc-base" src="${baseDataUri}" alt="">${layers}</div></body></html>`;
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
 * The `visuals` the tool writes: the base screenshot as the before, this
 * call's images as the mockups, everything else as the record had it. A
 * blank or stale `noVisualReason` is dropped — there is a visual now.
 * @param current - The record's `visuals` now.
 * @param ids - What was drawn.
 * @param ids.beforeId - The base screenshot's artifact.
 * @param ids.mockupIds - The drawn states, in order.
 */
export function mockupVisuals(current: unknown, ids: { beforeId: number; mockupIds: number[] }): Record<string, unknown> {
  const { noVisualReason: _dropped, ...rest } = bag(current);
  return { ...rest, beforeArtifactIds: [ids.beforeId], mockupArtifactIds: ids.mockupIds };
}

/**
 * The artifact role one drawn state is filed under on the request, so
 * drawing "Copied" again is a new version of the same image rather than a
 * fifth picture of it.
 * @param state - The state's name.
 */
export function mockupRole(state: string): string {
  const slug = state.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'default';
  return `mockup:${slug}`;
}
