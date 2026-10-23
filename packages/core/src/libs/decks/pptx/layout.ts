/**
 * Slide layout measurement: turns a rendered deck into the objects the
 * exporter writes.
 *
 * The page is the engine's own render, one `section#<id>` per slide laid out at
 * 1920 x 1080. This module only reads it: it walks each section's DOM with
 * `getBoundingClientRect` and computed styles, and screenshots the elements
 * that have no native PowerPoint form. Screenshots are isolated (everything
 * else on the page is made invisible and the page background transparent) so a
 * raster carries only its own element, and taken at device scale 2.
 *
 * The in-page walker is a plain JS string, not a TypeScript function: test and
 * build transforms inject helpers into function bodies that do not exist in
 * the browser.
 */

import type { CDPSession, Page } from 'playwright';
import type { Box, ImageObject, LayoutObject, RasterObject, ShapeObject, SlideLayout, TextObject, TextRun } from './types';
import { Buffer } from 'node:buffer';
import { objectName } from './shared';

export type MeasureOptions = {
  /** Screenshot scale for rasters. Default 2. */
  scale?: number;
  /** Fetches bytes for an image `src` that is not a data URI. Null means rasterise it instead. */
  fetchImage?: (src: string) => Promise<{ bytes: Buffer; contentType: string } | null>;
};

type RawRun = TextRun;
type RawObject
  = | { kind: 'text'; path: string; box: Box; runs: RawRun[]; align: TextObject['align']; lineHeightPx: number | null; letterSpacingPx: number; bullet: TextObject['bullet']; indentPx: number; suffix?: string }
    | { kind: 'image'; path: string; box: Box; src: string; alt: string; direct: boolean; rid: number }
    | { kind: 'shape'; path: string; suffix: string | null; box: Box; shape: ShapeObject['shape']; fill: string | null; fillTransparency: number; borderColor: string | null; borderPx: number; radiusPx: number }
    | { kind: 'raster'; path: string; suffix: string | null; box: Box; rid: number; reason: string };

type RawSlide = {
  id: string;
  missing?: boolean;
  width: number;
  height: number;
  bgColor: string;
  bgRid: number | null;
  notes: string;
  objects: RawObject[];
};

const WALKER = String.raw`(args) => {
  const INLINE = new Set(['a','abbr','b','bdi','bdo','br','cite','code','del','em','font','i','ins','kbd','mark','q','s','small','span','strong','sub','sup','time','u','wbr']);
  const RASTER_TAGS = new Set(['svg','x-icon','x-shape','x-connector','canvas','video']);
  const SKIP = new Set(['script','style','aside','template','head','link','meta','noscript']);
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  function rgba(c) {
    if (colorCache.has(c)) return colorCache.get(c);
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const a = d[3] / 255;
    const v = a > 0 ? { r: Math.round(d[0] * 255 / d[3]), g: Math.round(d[1] * 255 / d[3]), b: Math.round(d[2] * 255 / d[3]), a } : { r: 0, g: 0, b: 0, a: 0 };
    colorCache.set(c, v); return v;
  }
  function hex(v) { return [v.r, v.g, v.b].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  const px = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
  let rid = 0;
  const rasters = [];
  function mark(el, hc, pad) {
    const r = el.getBoundingClientRect();
    const id = ++rid;
    el.setAttribute('data-vx-r', String(id));
    rasters.push({ id, hc, rect: { x: r.left + window.scrollX - pad, y: r.top + window.scrollY - pad, w: r.width + pad * 2, h: r.height + pad * 2 } });
    return id;
  }
  const out = [];
  for (const id of args.ids) {
    const sec = document.getElementById(id);
    if (!sec) { out.push({ id, missing: true, objects: [] }); continue; }
    const sr = sec.getBoundingClientRect();
    const objects = [];
    const box = (r) => ({ x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height });
    const scs = getComputedStyle(sec);
    let bg = rgba(scs.backgroundColor);
    if (bg.a === 0) { bg = rgba(getComputedStyle(document.body).backgroundColor); if (bg.a === 0) bg = { r: 255, g: 255, b: 255, a: 1 }; }
    let bgRid = null;
    if (scs.backgroundImage !== 'none') bgRid = mark(sec, true, 0);
    let notes = '';
    const aside = sec.querySelector('aside');
    if (aside) {
      const blocks = Array.from(aside.querySelectorAll('p,li'));
      notes = (blocks.length ? blocks.map(b => b.textContent.replace(/\s+/g, ' ').trim()) : [aside.textContent.replace(/\s+/g, ' ').trim()]).filter(Boolean).join('\n');
    }
    const effOpacity = (el) => { let o = 1; for (let e = el; e && e !== sec.parentElement; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };

    function style(el, block) {
      const cs = getComputedStyle(el);
      let underline = false;
      for (let e = el; e; e = e.parentElement) { if (getComputedStyle(e).textDecorationLine.includes('underline')) underline = true; if (e === block) break; }
      return {
        fontFamily: cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
        sizePx: px(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400,
        italic: /italic|oblique/.test(cs.fontStyle), underline, color: hex(rgba(cs.color)),
        tt: cs.textTransform,
      };
    }
    function transform(t, tt) {
      if (tt === 'uppercase') return t.toUpperCase();
      if (tt === 'lowercase') return t.toLowerCase();
      if (tt === 'capitalize') return t.replace(/(^|[\s\-(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      return t;
    }
    function isInline(el) {
      if (!INLINE.has(el.tagName.toLowerCase())) return false;
      const cs = getComputedStyle(el);
      if (!(cs.display === 'inline' || cs.display === 'contents')) return false;
      for (const c of el.children) if (!isInline(c)) return false;
      return true;
    }
    function isLeaf(el) {
      if (!el.textContent.trim()) return false;
      for (const c of el.children) if (!isInline(c)) return false;
      return true;
    }
    function runsOf(el) {
      const cs = getComputedStyle(el);
      const pre = /pre/.test(cs.whiteSpace);
      const parts = [];
      const rec = (node) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) {
            const pe = n.parentElement; const st = style(pe, el);
            let t = n.data;
            if (!pre) t = t.replace(/[ \t\r\n\f]+/g, ' ');
            parts.push({ t: transform(t, st.tt), st });
          } else if (n.nodeType === 1) {
            if (n.tagName === 'BR') parts.push({ t: '\n', st: style(el, el) });
            else if (n.tagName !== 'WBR') rec(n);
          }
        }
      };
      rec(el);
      const runs = [];
      let last = '';
      for (const p of parts) {
        let t = p.t;
        if (!pre && (last === '' || last.endsWith(' ') || last.endsWith('\n')) && t.startsWith(' ')) t = t.slice(1);
        if (!pre && last.endsWith(' ') && t.startsWith('\n')) { runs[runs.length - 1].text = runs[runs.length - 1].text.slice(0, -1); }
        if (t === '') continue;
        const { tt, ...st } = p.st;
        const prev = runs[runs.length - 1];
        if (prev && prev.fontFamily === st.fontFamily && prev.sizePx === st.sizePx && prev.weight === st.weight && prev.italic === st.italic && prev.underline === st.underline && prev.color === st.color) prev.text += t;
        else runs.push({ text: t, ...st });
        last = t;
      }
      if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ $/, '');
      return runs.filter(r => r.text !== '');
    }
    function textBox(el, cs, r) {
      const bl = px(cs.borderLeftWidth), br = px(cs.borderRightWidth), pl = px(cs.paddingLeft), pr = px(cs.paddingRight);
      const range = document.createRange(); range.selectNodeContents(el);
      const rr = range.getBoundingClientRect();
      const x = r.left + bl + pl, w = r.width - bl - br - pl - pr;
      let y = rr.height > 0 ? rr.top : r.top, h = rr.height > 0 ? rr.height : r.height;
      const lh = cs.lineHeight === 'normal' ? 0 : px(cs.lineHeight);
      const first = range.getClientRects()[0];
      if (lh > 0 && first && rr.height > 0) {
        // The line boxes, not the glyph boxes: PowerPoint's exact line spacing starts at the top of the line.
        const n = Math.max(1, Math.round((rr.height - first.height) / lh) + 1);
        y = rr.top - (lh - first.height) / 2; h = n * lh;
      }
      return { x: x - sr.left, y: y - sr.top, w: Math.max(w, 1), h };
    }
    function pushText(el, cs, r, path, suffix) {
      const runs = runsOf(el);
      if (!runs.length) return;
      let align = cs.textAlign;
      if (align === 'start' || align === 'left' || align === '-webkit-left') align = 'left';
      else if (align === 'end' || align === 'right' || align === '-webkit-right') align = 'right';
      else if (align === 'center' || align === '-webkit-center') align = 'center';
      else if (align === 'justify') align = 'justify'; else align = 'left';
      const lh = cs.lineHeight === 'normal' ? null : px(cs.lineHeight);
      const ls = cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing);
      let bullet = null, indent = 0;
      if (cs.display === 'list-item' && cs.listStyleType !== 'none' && el.parentElement) {
        const pt = el.parentElement.tagName.toLowerCase();
        bullet = pt === 'ol' ? 'number' : 'bullet';
        indent = Math.min(64, Math.max(16, r.left - el.parentElement.getBoundingClientRect().left)) || 24;
      }
      const o = { kind: 'text', path, box: textBox(el, cs, r), runs, align, lineHeightPx: lh, letterSpacingPx: ls, bullet, indentPx: indent };
      if (suffix) o.suffix = suffix;
      objects.push(o);
    }
    function decor(el, cs, r, path) {
      const bgc = rgba(cs.backgroundColor);
      const op = effOpacity(el);
      const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
      const bs = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
      const bc = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(rgba);
      const hasBorder = bw.some((w, i) => w > 0 && bs[i] !== 'none' && bs[i] !== 'hidden' && bc[i].a > 0);
      const special = cs.backgroundImage !== 'none' || cs.boxShadow !== 'none' || cs.filter !== 'none' || cs.clipPath !== 'none' || cs.backdropFilter !== 'none';
      if (special) {
        const pad = cs.boxShadow !== 'none' ? 48 : 0;
        const id2 = mark(el, true, pad);
        const b = box(r);
        objects.push({ kind: 'raster', path, suffix: 'bg', box: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, rid: id2, reason: 'gradient, image, shadow or filter background' });
        return;
      }
      if (bgc.a === 0 && !hasBorder) return;
      const uniform = hasBorder && bw.every(w => w === bw[0]) && bs.every(s => s === bs[0]) && bc.every(c => hex(c) === hex(bc[0]) && c.a === bc[0].a);
      const minSide = Math.min(r.width, r.height);
      const rad = Math.max(...['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(k => { const v = cs[k]; return v.endsWith('%') ? parseFloat(v) / 100 * minSide : px(v); }));
      let shape = 'rect';
      if (rad > 0.5) shape = (rad >= minSide / 2 - 0.5 && Math.abs(r.width - r.height) <= 2) ? 'ellipse' : 'rounded';
      objects.push({
        kind: 'shape', path, suffix: 'bg', box: box(r), shape,
        fill: bgc.a > 0 ? hex(bgc) : null, fillTransparency: bgc.a > 0 ? Math.max(0, Math.min(1, 1 - bgc.a * op)) : 1,
        borderColor: uniform ? hex(bc[0]) : null, borderPx: uniform ? bw[0] : 0, radiusPx: Math.min(rad, minSide / 2),
      });
      if (hasBorder && !uniform) {
        const b = box(r);
        const sides = [['bt', 0, b.x, b.y, b.w, bw[0]], ['br', 1, b.x + b.w - bw[1], b.y, bw[1], b.h], ['bb', 2, b.x, b.y + b.h - bw[2], b.w, bw[2]], ['bl', 3, b.x, b.y, bw[3], b.h]];
        for (const [sfx, i, x, y, w, h] of sides) {
          if (bw[i] > 0 && bs[i] !== 'none' && bs[i] !== 'hidden' && bc[i].a > 0) objects.push({ kind: 'shape', path, suffix: sfx, box: { x, y, w, h }, shape: 'rect', fill: hex(bc[i]), fillTransparency: 1 - bc[i].a, borderColor: null, borderPx: 0, radiusPx: 0 });
        }
      }
    }
    function walk(el, path) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 0.5 && r.height < 0.5) return;
      const p = path.join('.');
      if (RASTER_TAGS.has(tag)) { objects.push({ kind: 'raster', path: p, suffix: null, box: box(r), rid: mark(el, false, 0), reason: '<' + tag + '> has no native form' }); return; }
      if (tag === 'img') {
        const src = el.currentSrc || el.src || '';
        const radius = ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].some(k => px(cs[k]) > 0 || cs[k].endsWith('%') && parseFloat(cs[k]) > 0);
        const aspectOk = el.naturalWidth > 0 && Math.abs(el.naturalWidth / el.naturalHeight - r.width / r.height) < 0.02;
        objects.push({ kind: 'image', path: p, box: box(r), src, alt: el.getAttribute('alt') || '', direct: !radius && aspectOk && (cs.objectFit === 'fill' || cs.objectFit === 'contain' || cs.objectFit === 'cover') && effOpacity(el) === 1 && cs.filter === 'none', rid: mark(el, false, 0) });
        return;
      }
      decor(el, cs, r, p);
      if (isLeaf(el)) { pushText(el, cs, r, p, null); return; }
      let k = 0;
      for (const n of el.childNodes) {
        if (n.nodeType === 1) { walk(n, path.concat(Array.from(el.children).indexOf(n))); }
        else if (n.nodeType === 3 && n.data.trim()) {
          const range = document.createRange(); range.selectNodeContents(n);
          const rr = range.getBoundingClientRect();
          if (rr.width > 0) {
            const st = style(el, el);
            objects.push({ kind: 'text', path: p, suffix: 'anon' + (k++), box: box(rr), runs: [{ text: transform(n.data.replace(/\s+/g, ' ').trim(), st.tt), fontFamily: st.fontFamily, sizePx: st.sizePx, weight: st.weight, italic: st.italic, underline: st.underline, color: st.color }], align: 'left', lineHeightPx: null, letterSpacingPx: 0, bullet: null, indentPx: 0 });
          }
        }
      }
    }
    Array.from(sec.children).forEach((c, i) => walk(c, [i]));
    out.push({ id, width: sr.width, height: sr.height, bgColor: hex(bg), bgRid, notes, objects });
  }
  return { slides: out, rasters };
}`;

const STYLE_CSS = `
html.vx-iso, html.vx-iso body { background: transparent !important; }
html.vx-iso * { visibility: hidden !important; }
html.vx-iso .vx-t, html.vx-iso .vx-t * { visibility: visible !important; }
html.vx-iso .vx-t.vx-hc * { visibility: hidden !important; }
html.vx-iso .vx-t.vx-hc { color: transparent !important; text-shadow: none !important; }
`;

type RasterJob = { id: number; hc: boolean; rect: { x: number; y: number; w: number; h: number } };

async function shoot(page: Page, cdp: CDPSession, job: RasterJob, scale: number): Promise<Buffer> {
  await page.evaluate(([id, hc]) => {
    const el = document.querySelector(`[data-vx-r="${id}"]`);
    document.documentElement.classList.add('vx-iso');
    el?.classList.add('vx-t');
    if (hc) {
      el?.classList.add('vx-hc');
    }
  }, [job.id, job.hc] as const);
  try {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: Math.max(0, job.rect.x), y: Math.max(0, job.rect.y), width: Math.max(1, job.rect.w), height: Math.max(1, job.rect.h), scale },
    });
    return Buffer.from(shot.data, 'base64');
  } finally {
    await page.evaluate((id) => {
      document.documentElement.classList.remove('vx-iso');
      const el = document.querySelector(`[data-vx-r="${id}"]`);
      el?.classList.remove('vx-t', 'vx-hc');
    }, job.id);
  }
}

function dataUri(src: string): { bytes: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(src);
  if (!m) {
    return null;
  }
  return { contentType: m[1]!, bytes: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)) };
}

/**
 * Measures a rendered deck into per-slide layouts.
 * @param page - A Playwright page with the deck already rendered: one `section#<id>` per slide at 1920 x 1080.
 * @param slideIds - The slides to measure, in the order wanted back.
 * @param opts - Raster scale and an optional image fetcher.
 * @returns One `SlideLayout` per id. A slide whose section is missing comes back with no objects.
 */
export async function measureSlideLayouts(page: Page, slideIds: string[], opts: MeasureOptions = {}): Promise<SlideLayout[]> {
  const scale = opts.scale ?? 2;
  await page.addStyleTag({ content: STYLE_CSS });
  const raw = await page.evaluate(`(${WALKER})(${JSON.stringify({ ids: slideIds })})`) as { slides: RawSlide[]; rasters: RasterJob[] };
  const jobs = new Map(raw.rasters.map(j => [j.id, j]));
  const pngs = new Map<number, Buffer>();

  const wanted = new Set<number>();
  for (const s of raw.slides) {
    if (s.bgRid) {
      wanted.add(s.bgRid);
    }
    for (const o of s.objects) {
      if (o.kind === 'raster') {
        wanted.add(o.rid);
      }
    }
  }
  const imageBytes = new Map<number, { bytes: Buffer; contentType: 'image/png' | 'image/jpeg' }>();
  for (const s of raw.slides) {
    for (const o of s.objects) {
      if (o.kind !== 'image') {
        continue;
      }
      let got = o.direct ? (dataUri(o.src) ?? (await opts.fetchImage?.(o.src)) ?? null) : null;
      if (got && !/^image\/(?:png|jpeg|jpg)$/.test(got.contentType)) {
        got = null;
      }
      if (got) {
        imageBytes.set(o.rid, { bytes: got.bytes, contentType: got.contentType === 'image/png' ? 'image/png' : 'image/jpeg' });
      } else {
        wanted.add(o.rid);
      }
    }
  }

  if (wanted.size > 0) {
    // CDP, not page.screenshot: only the protocol lets a clip be scaled, and a transparent default background gives each raster an alpha channel.
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      for (const id of wanted) {
        const job = jobs.get(id);
        if (job) {
          pngs.set(id, await shoot(page, cdp, job, scale));
        }
      }
    } finally {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {}).catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    }
  }

  await page.evaluate(() => {
    document.querySelectorAll('[data-vx-r]').forEach(el => el.removeAttribute('data-vx-r'));
  });

  return raw.slides.map((s): SlideLayout => {
    if (s.missing) {
      return { slideId: s.id, width: 1920, height: 1080, background: { color: 'FFFFFF' }, objects: [], notes: '' };
    }
    const objects: LayoutObject[] = [];
    for (const o of s.objects) {
      const name = objectName(s.id, o.path, 'suffix' in o && o.suffix ? o.suffix : undefined);
      switch (o.kind) {
        case 'text':
          objects.push({ kind: 'text', name, box: o.box, runs: o.runs, align: o.align, lineHeightPx: o.lineHeightPx, letterSpacingPx: o.letterSpacingPx, bullet: o.bullet, indentPx: o.indentPx });
          break;
        case 'shape':
          objects.push({ kind: 'shape', name, box: o.box, shape: o.shape, fill: o.fill, fillTransparency: o.fillTransparency, borderColor: o.borderColor, borderPx: o.borderPx, radiusPx: o.radiusPx } satisfies ShapeObject);
          break;
        case 'raster': {
          const png = pngs.get(o.rid);
          if (png) {
            objects.push({ kind: 'raster', name, box: o.box, png, reason: o.reason } satisfies RasterObject);
          }
          break;
        }
        case 'image': {
          const direct = imageBytes.get(o.rid);
          const png = pngs.get(o.rid);
          const bytes = direct?.bytes ?? png;
          if (bytes) {
            objects.push({ kind: 'image', name, box: o.box, bytes, contentType: direct?.contentType ?? 'image/png', src: o.src, alt: o.alt } satisfies ImageObject);
          }
          break;
        }
      }
    }
    const bgPng = s.bgRid ? pngs.get(s.bgRid) : undefined;
    return { slideId: s.id, width: s.width, height: s.height, background: bgPng ? { png: bgPng } : { color: s.bgColor }, objects, notes: s.notes };
  });
}
