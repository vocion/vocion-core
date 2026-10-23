/**
 * The deck audit — DOM facts in, a verdict and a receipt out.
 *
 * Two halves, like the document audit. `MEASURE_SLIDES` runs in the rendered
 * page and reports what Chromium laid out: what runs past the 1920×1080
 * canvas, text set under 24px, content under the footer line that is not the
 * footer band, how many elements, what the runtime could not draw, which
 * images did not load. `staticSlideFacts` reads what the markup alone says —
 * placeholders, notes, asset references. `evaluateDeck` (pure) merges them
 * and decides.
 *
 * Severity follows the document audit: an `issue` blocks (`ok` is false and
 * the agent fixes it before it calls the deck done); a `report` is listed and
 * never flips `ok` — content under the footer line, an unresolved placeholder
 * and a slide with no notes are judgement calls a person makes.
 */

import type { DeckSlideAudit, DeckSpec, DeckVerification } from '@/libs/cards/specs';
import { FOOTER_LINE_Y, SLIDE_HEIGHT, SLIDE_WIDTH } from './page';
import { assetRefs, checkSlide, findPlaceholders, MAX_SLIDE_ELEMENTS, slideText } from './slides';

export const MIN_TEXT_PX = 24;
/** The footer band: pinned elements whose top is at or below the footer line and that are at most this tall. */
export const FOOTER_BAND_MAX_HEIGHT = 80;

/** What the browser reports per slide (`MEASURE_SLIDES`). */
export type MeasuredSlideDom = {
  id: string;
  n: number;
  overflowPx: number;
  clipped: string[];
  smallText: string[];
  belowFooter: string[];
  elementCount: number;
  unknownElements: string[];
  brokenImages: string[];
};

/**
 * Measure every slide in a loaded render page. Runs in the browser after the
 * runtime (`data-vocion-runtime="ready"`). Coordinates are slide px: the
 * frame's rect is divided by its scale, so a scaled viewer measures the same.
 */
export const MEASURE_SLIDES = `(() => {
  const W = ${SLIDE_WIDTH}, H = ${SLIDE_HEIGHT}, LINE = ${FOOTER_LINE_Y}, BAND = ${FOOTER_BAND_MAX_HEIGHT}, MIN = ${MIN_TEXT_PX};
  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const desc = (el) => { const t = text(el); return el.tagName.toLowerCase() + (t ? ' "' + t + '"' : ''); };
  const ownText = (el) => Array.prototype.some.call(el.childNodes, (c) => c.nodeType === 3 && c.textContent.trim() !== '');
  return Array.from(document.querySelectorAll('.vocion-slide')).map((frame, i) => {
    const id = frame.getAttribute('data-slide-id') || String(i + 1);
    const section = frame.querySelector(':scope > section');
    const fr = frame.getBoundingClientRect();
    const scale = fr.width > 0 ? fr.width / W : 1;
    const rel = (r) => ({ left: (r.left - fr.left) / scale, top: (r.top - fr.top) / scale, right: (r.right - fr.left) / scale, bottom: (r.bottom - fr.top) / scale, width: r.width / scale, height: r.height / scale });
    const out = { id, n: i + 1, overflowPx: 0, clipped: [], smallText: [], belowFooter: [], elementCount: 0, unknownElements: [], brokenImages: [] };
    if (!section) return out;
    const authored = Array.from(section.querySelectorAll('*')).filter((el) => !el.closest('[data-vocion-generated]'));
    out.elementCount = authored.length;
    const band = authored.filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
      const r = rel(el.getBoundingClientRect());
      return r.top >= LINE - 0.5 && r.height <= BAND;
    });
    const inBand = (el) => band.some((b) => b === el || b.contains(el));
    for (const el of authored) {
      if (el.closest('aside')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = rel(el.getBoundingClientRect());
      if (r.width === 0 && r.height === 0) continue;
      const tag = el.tagName.toLowerCase();
      const past = Math.max(r.right - W, r.bottom - H, -r.left, -r.top);
      if (past > 1 && tag !== 'x-connector') {
        out.overflowPx = Math.max(out.overflowPx, Math.round(past));
        if (out.clipped.length < 12) out.clipped.push(desc(el) + ' (+' + Math.round(past) + 'px)');
      }
      const texty = ownText(el);
      if (texty) {
        const size = parseFloat(cs.fontSize);
        if (size < MIN - 0.01 && out.smallText.length < 12) out.smallText.push(desc(el) + ' (' + Math.round(size * 10) / 10 + 'px)');
      }
      if ((texty || tag === 'img' || tag === 'x-icon') && r.bottom > LINE + 1 && !inBand(el) && out.belowFooter.length < 12) {
        out.belowFooter.push(desc(el) + ' (to y ' + Math.round(r.bottom) + ')');
      }
    }
    out.unknownElements = Array.from(new Set(Array.from(section.querySelectorAll('[data-vocion-unknown]')).map((el) => el.getAttribute('data-vocion-unknown')))).slice(0, 20);
    out.brokenImages = Array.from(section.querySelectorAll('img')).filter((im) => im.complete && im.naturalWidth === 0).map((im) => im.getAttribute('src') || '').filter(Boolean).slice(0, 20);
    return out;
  });
})()`;

/** What the markup alone says about one slide. */
export type StaticSlideFacts = {
  id: string;
  n: number;
  label: string;
  placeholders: string[];
  hasNotes: boolean;
  /** Asset ids with no entry in `assets`, data: URIs and outside URLs. */
  unresolvedAssets: string[];
  unknownElements: string[];
  elementCount: number;
};

/**
 * The static facts for every slide, in deck order.
 * @param spec - The deck.
 */
export function staticSlideFacts(spec: Pick<DeckSpec, 'order' | 'slides' | 'assets'>): StaticSlideFacts[] {
  return spec.order.map((id, i) => {
    const html = spec.slides[id] ?? '';
    const t = slideText(html);
    const refs = assetRefs(html);
    const check = checkSlide(id, html);
    const unresolved = [
      ...refs.ids.filter(a => !spec.assets?.[a]).map(a => `asset:${a} (no such asset)`),
      ...(refs.dataUris > 0 ? [`${refs.dataUris} data: URI${refs.dataUris === 1 ? '' : 's'} (upload the image as an asset)`] : []),
      ...refs.other.map(u => `${u} (not a Vocion asset)`),
    ];
    return {
      id,
      n: i + 1,
      label: t.label,
      placeholders: findPlaceholders(t.text),
      hasNotes: t.notes.length > 0,
      unresolvedAssets: unresolved.slice(0, 20),
      unknownElements: check.unknownElements,
      elementCount: check.elementCount,
    };
  });
}

export type MeasuredSlide = Omit<DeckSlideAudit, 'image'> & { image?: string };

/**
 * One slide's audit from both halves. With no DOM (renderer unavailable) the
 * geometry is empty and only the static facts stand.
 * @param facts - The static half.
 * @param dom - The browser half, when there was a render.
 * @param image - The screenshot's served URL.
 */
export function mergeSlideFacts(facts: StaticSlideFacts, dom?: MeasuredSlideDom | null, image?: string): MeasuredSlide {
  return {
    id: facts.id,
    n: facts.n,
    ...(facts.label ? { label: facts.label } : {}),
    overflowPx: dom?.overflowPx ?? 0,
    clipped: dom?.clipped ?? [],
    smallText: dom?.smallText ?? [],
    belowFooter: dom?.belowFooter ?? [],
    elementCount: dom?.elementCount ?? facts.elementCount,
    unknownElements: [...new Set([...facts.unknownElements, ...(dom?.unknownElements ?? [])])].slice(0, 20),
    unresolvedAssets: [...new Set([...facts.unresolvedAssets, ...(dom?.brokenImages ?? []).map(s => `${s} (did not load)`)])].slice(0, 20),
    placeholders: facts.placeholders,
    hasNotes: facts.hasNotes,
    ...(image ? { image } : {}),
  };
}

function list(items: string[], max = 3): string {
  return `${items.slice(0, max).join('; ')}${items.length > max ? ` and ${items.length - max} more` : ''}`;
}

/**
 * Decide. Every line names the slide by number and label, so the model can
 * act on it and a person can check it against the screenshot.
 * @param input - The merged slides, and the PDF when one was printed.
 * @param input.slides
 * @param input.pdfPages
 * @param input.pdf
 * @param input.at
 * @param input.extraIssues - Lines from outside the slides (a renderer that could not run).
 */
export function evaluateDeck(input: { slides: MeasuredSlide[]; pdfPages: number | null; pdf?: string; at?: string; extraIssues?: string[] }): DeckVerification {
  const issues: string[] = [...(input.extraIssues ?? [])];
  const reports: string[] = [];
  for (const s of input.slides) {
    const where = s.label ? `Slide ${s.n} (${s.label.slice(0, 60)})` : `Slide ${s.n}`;
    if (s.overflowPx > 0 || s.clipped.length > 0) {
      issues.push(`${where}: ${s.clipped.length ? list(s.clipped) : 'content'} runs past the 1920×1080 canvas by up to ${s.overflowPx}px. Trim or tighten it.`);
    }
    if (s.smallText.length > 0) {
      issues.push(`${where}: text under ${MIN_TEXT_PX}px — ${list(s.smallText)}. Nobody reads that from the back of the room; cut words rather than shrink them.`);
    }
    if (s.elementCount > MAX_SLIDE_ELEMENTS) {
      issues.push(`${where} has ${s.elementCount} elements; the limit is ${MAX_SLIDE_ELEMENTS}. Split the slide.`);
    }
    if (s.unknownElements.length > 0) {
      issues.push(`${where}: Vocion cannot draw ${list(s.unknownElements, 5)}. Use an element, icon or shape kind from the deck format.`);
    }
    if (s.unresolvedAssets.length > 0) {
      issues.push(`${where}: ${list(s.unresolvedAssets, 4)}. Images are assets: src="asset:<id>".`);
    }
    if (s.belowFooter.length > 0) {
      reports.push(`${where}: below the footer line (y ${FOOTER_LINE_Y}) — ${list(s.belowFooter)}.`);
    }
    if (s.placeholders.length > 0) {
      reports.push(`${where}: placeholders still open — ${s.placeholders.slice(0, 5).join(', ')}.`);
    }
    if (!s.hasNotes) {
      reports.push(`${where} has no speaker notes.`);
    }
  }
  if (input.slides.length === 0) {
    issues.push('The deck has no slides.');
  }
  if (input.pdfPages !== null && input.pdfPages !== input.slides.length) {
    issues.push(`The PDF has ${input.pdfPages} pages for ${input.slides.length} slides — a slide is taller than its page.`);
  }
  return {
    at: input.at ?? new Date().toISOString(),
    slides: input.slides,
    pdfPages: input.pdfPages,
    ...(input.pdf ? { pdf: input.pdf } : {}),
    issues: issues.slice(0, 40),
    reports: reports.slice(0, 40),
    ok: issues.length === 0,
  };
}

/**
 * The receipt the agent reads back: the verdict, every issue, the reports, and
 * (optionally) each slide's screenshot URL.
 * @param v - The verification.
 * @param opts - Whether to list the screenshots.
 * @param opts.images
 */
export function deckVerificationReceipt(v: DeckVerification, opts: { images?: boolean } = {}): string {
  const n = v.slides.length;
  const head = [
    `${n} ${n === 1 ? 'slide' : 'slides'}`,
    v.pdfPages === null ? (v.pdf ? 'PDF printed' : 'PDF not printed') : `PDF ${v.pdfPages} ${v.pdfPages === 1 ? 'page' : 'pages'}`,
    v.ok ? 'no issues' : `${v.issues.length} ${v.issues.length === 1 ? 'issue' : 'issues'}`,
    ...(v.reports.length ? [`${v.reports.length} to look at`] : []),
  ].join(' · ');
  const lines = [head, ...v.issues.map(i => `- ${i}`), ...v.reports.map(r => `- note: ${r}`)];
  if (opts.images) {
    for (const s of v.slides) {
      if (s.image) {
        lines.push(`  slide ${s.n} [${s.id}]${s.label ? ` (${s.label.slice(0, 60)})` : ''}: ${s.image}`);
      }
    }
  }
  return lines.join('\n');
}

/**
 * "12 slides · verified" / "12 slides · 2 issues" — the chip beside a deck, the twin of `verificationChip`.
 * @param v - `spec.verification`.
 * @param slideCount - `order.length`, when there is no verification.
 */
export function deckVerificationChip(v: DeckVerification | undefined, slideCount: number | undefined): string {
  const n = v?.slides.length ?? slideCount;
  const count = n === undefined ? '' : `${n} ${n === 1 ? 'slide' : 'slides'}`;
  if (!v) {
    return count ? `${count} · not verified` : 'not verified';
  }
  const state = v.ok ? 'verified' : `${v.issues.length} ${v.issues.length === 1 ? 'issue' : 'issues'}`;
  return count ? `${count} · ${state}` : state;
}
