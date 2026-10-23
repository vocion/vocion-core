/**
 * Reads a PPTX back into the deck, merging instead of replacing.
 *
 * A slide that is still recognisable (its notes marker or its object names say
 * which slide it was) keeps its original HTML byte-for-byte; text the person
 * changed is spliced into that HTML at the element the object names. A slide
 * that is new, or whose objects were added or removed, is converted to
 * absolutely positioned HTML. Deleted slides disappear and the file's order
 * wins. Layout, colour and font edits to a recognised slide are not applied:
 * only text and notes come back.
 */

import type { Buffer } from 'node:buffer';
import type { Splice } from './htmlText';
import type { DeckFiles, ImportReportEntry, NewAsset } from './types';
import type { XNode } from './xml';
import JSZip from 'jszip';
import { applySplices, elementAtPath, parseLocated, planTextEdit, textOfElement } from './htmlText';
import { normText, parseObjectName, splitMarker, textHash } from './shared';
import { child, childrenOf, descendants, parseXml, textContent } from './xml';

// ---------------------------------------------------------------------------

type PRun = { text: string; bold: boolean; italic: boolean; underline: boolean; color: string | null; sizePx: number | null; font: string | null };
type PPara = { align: string | null; runs: PRun[] };
type PObject = {
  kind: 'sp' | 'pic' | 'table';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  paras: PPara[];
  placeholder: boolean;
  fill: string | null;
  geom: string | null;
  insets: [number, number, number, number];
  rId: string | null;
  alt: string;
  rows: string[][];
};
type PSlide = { objects: PObject[]; bg: string | null; notes: string; mediaByRid: Record<string, string> };

function fillColor(spPr: XNode | undefined): string | null {
  const solid = child(spPr, 'a:solidFill');
  const clr = child(solid, 'a:srgbClr');
  return clr?.attrs.val ? clr.attrs.val.toUpperCase() : null;
}

function paraText(p: PPara): string {
  return p.runs.map(r => r.text).join('');
}

/**
 * The text of an object as the exporter hashed it: paragraphs on lines.
 * @param o - The text object.
 */
function objectText(o: PObject): string {
  return normText(o.paras.map(paraText).join('\n'));
}

function readParas(txBody: XNode | undefined, pxPerEmu: number): PPara[] {
  const paras: PPara[] = [];
  for (const p of childrenOf(txBody, 'a:p')) {
    const para: PPara = { align: child(p, 'a:pPr')?.attrs.algn ?? null, runs: [] };
    for (const k of p.kids) {
      if (k.tag === 'a:r' || k.tag === 'a:fld') {
        const rPr = child(k, 'a:rPr');
        const t = child(k, 'a:t');
        const sz = rPr?.attrs.sz ? Number(rPr.attrs.sz) : null;
        para.runs.push({
          text: t ? textContent(t) : '',
          bold: rPr?.attrs.b === '1',
          italic: rPr?.attrs.i === '1',
          underline: !!rPr?.attrs.u && rPr.attrs.u !== 'none',
          color: fillColor(rPr),
          sizePx: sz ? (sz / 100) * 12700 * pxPerEmu : null,
          font: child(rPr, 'a:latin')?.attrs.typeface ?? null,
        });
      } else if (k.tag === 'a:br') {
        para.runs.push({ text: '\n', bold: false, italic: false, underline: false, color: null, sizePx: null, font: null });
      }
    }
    paras.push(para);
  }
  return paras;
}

type Xf = { ox: number; oy: number; sx: number; sy: number };

function readShapes(tree: XNode, pxPerEmu: number, xf: Xf, out: PObject[]): void {
  for (const n of tree.kids) {
    if (n.tag === 'p:grpSp') {
      const gx = child(child(n, 'p:grpSpPr'), 'a:xfrm');
      const off = child(gx, 'a:off');
      const ext = child(gx, 'a:ext');
      const choff = child(gx, 'a:chOff');
      const chext = child(gx, 'a:chExt');
      let inner = xf;
      if (off && ext && choff && chext && Number(chext.attrs.cx) > 0 && Number(chext.attrs.cy) > 0) {
        const sx = Number(ext.attrs.cx) / Number(chext.attrs.cx);
        const sy = Number(ext.attrs.cy) / Number(chext.attrs.cy);
        inner = {
          ox: xf.ox + (Number(off.attrs.x) - Number(choff.attrs.x) * sx) * xf.sx,
          oy: xf.oy + (Number(off.attrs.y) - Number(choff.attrs.y) * sy) * xf.sy,
          sx: xf.sx * sx,
          sy: xf.sy * sy,
        };
      }
      readShapes(n, pxPerEmu, inner, out);
      continue;
    }
    if (n.tag !== 'p:sp' && n.tag !== 'p:pic' && n.tag !== 'p:graphicFrame') {
      continue;
    }
    const nv = child(n, n.tag === 'p:sp' ? 'p:nvSpPr' : n.tag === 'p:pic' ? 'p:nvPicPr' : 'p:nvGraphicFramePr');
    const cNvPr = child(nv, 'p:cNvPr');
    const xfrm = n.tag === 'p:graphicFrame' ? child(n, 'p:xfrm') : child(child(n, 'p:spPr'), 'a:xfrm');
    const off = child(xfrm, 'a:off');
    const ext = child(xfrm, 'a:ext');
    const e = (v: string | undefined, o: number, s: number) => (Number(v ?? 0) * s + o) * pxPerEmu;
    const obj: PObject = {
      kind: n.tag === 'p:sp' ? 'sp' : n.tag === 'p:pic' ? 'pic' : 'table',
      name: cNvPr?.attrs.name ?? '',
      x: e(off?.attrs.x, xf.ox, xf.sx),
      y: e(off?.attrs.y, xf.oy, xf.sy),
      w: Number(ext?.attrs.cx ?? 0) * xf.sx * pxPerEmu,
      h: Number(ext?.attrs.cy ?? 0) * xf.sy * pxPerEmu,
      paras: [],
      placeholder: !!child(child(nv, 'p:nvPr'), 'p:ph'),
      fill: null,
      geom: null,
      insets: [91440, 45720, 91440, 45720],
      rId: null,
      alt: cNvPr?.attrs.descr ?? '',
      rows: [],
    };
    if (n.tag === 'p:sp') {
      const spPr = child(n, 'p:spPr');
      obj.fill = fillColor(spPr);
      obj.geom = child(spPr, 'a:prstGeom')?.attrs.prst ?? null;
      const body = child(n, 'p:txBody');
      const bp = child(body, 'a:bodyPr');
      if (bp) {
        obj.insets = [Number(bp.attrs.lIns ?? 91440), Number(bp.attrs.tIns ?? 45720), Number(bp.attrs.rIns ?? 91440), Number(bp.attrs.bIns ?? 45720)];
      }
      obj.paras = readParas(body, pxPerEmu);
    } else if (n.tag === 'p:pic') {
      obj.rId = child(child(n, 'p:blipFill'), 'a:blip')?.attrs['r:embed'] ?? null;
    } else {
      for (const tr of descendants(n, 'a:tr')) {
        obj.rows.push(childrenOf(tr, 'a:tc').map(tc => childrenOf(child(tc, 'a:txBody'), 'a:p').map(p => descendants(p, 'a:t').map(textContent).join('')).join('\n')));
      }
    }
    out.push(obj);
  }
}

type Rels = Record<string, { type: string; target: string }>;

function relsOf(xml: string | null, baseDir: string): Rels {
  const out: Rels = {};
  if (!xml) {
    return out;
  }
  for (const r of descendants({ tag: 'root', attrs: {}, kids: parseXml(xml) }, 'Relationship')) {
    const t = r.attrs.Target ?? '';
    out[r.attrs.Id ?? ''] = { type: r.attrs.Type ?? '', target: t.startsWith('/') ? t.slice(1) : resolvePath(baseDir, t) };
  }
  return out;
}

function resolvePath(dir: string, target: string): string {
  const parts = dir.split('/').filter(Boolean);
  for (const seg of target.split('/')) {
    if (seg === '..') {
      parts.pop();
    } else if (seg !== '.') {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

const MEDIA_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

// ---------------------------------------------------------------------------

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escAttr = (s: string) => esc(s).replaceAll('"', '&quot;');
const r1 = (n: number) => Math.round(n * 10) / 10;

function runHtml(r: PRun, base: PRun): string {
  const styles: string[] = [];
  if (r.bold !== base.bold) {
    styles.push(`font-weight:${r.bold ? 700 : 400}`);
  }
  if (r.italic !== base.italic) {
    styles.push(`font-style:${r.italic ? 'italic' : 'normal'}`);
  }
  if (r.underline !== base.underline) {
    styles.push(`text-decoration:${r.underline ? 'underline' : 'none'}`);
  }
  if (r.color && r.color !== base.color) {
    styles.push(`color:#${r.color}`);
  }
  if (r.sizePx && r.sizePx !== base.sizePx) {
    styles.push(`font-size:${r1(r.sizePx)}px`);
  }
  if (r.font && r.font !== base.font) {
    styles.push(`font-family:'${r.font.replaceAll('\'', '')}'`);
  }
  const text = esc(r.text).replaceAll('\n', '<br>');
  return styles.length ? `<span style="${styles.join(';')}">${text}</span>` : text;
}

const ALIGN: Record<string, string> = { l: 'left', ctr: 'center', r: 'right', just: 'justify' };

type ConvertCtx = { slideKey: string; slide: PSlide; scale: number; assetFor: (rId: string, alt: string) => string | null };

function convertObject(o: PObject, ctx: ConvertCtx): string {
  const geo = `position:absolute;left:${r1(o.x)}px;top:${r1(o.y)}px;width:${r1(o.w)}px;height:${r1(o.h)}px;margin:0`;
  if (o.kind === 'pic') {
    const key = o.rId ? ctx.assetFor(o.rId, o.alt) : null;
    return key ? `<img src="asset:${key}" alt="${escAttr(o.alt)}" style="${geo};object-fit:fill">` : '';
  }
  if (o.kind === 'table') {
    const rows = o.rows.map(r => `<tr>${r.map(c => `<td style="border:1px solid #888;padding:6px 10px">${esc(c).replaceAll('\n', '<br>')}</td>`).join('')}</tr>`).join('');
    return `<table style="${geo};border-collapse:collapse"><tbody>${rows}</tbody></table>`;
  }
  const text = o.paras.map(paraText).join('').trim();
  const radius = o.geom === 'ellipse' ? ';border-radius:50%' : o.geom === 'roundRect' ? ';border-radius:16px' : '';
  const fill = o.fill ? `;background:#${o.fill}` : '';
  if (!text) {
    return o.fill ? `<div style="${geo}${fill}${radius}"></div>` : '';
  }
  const first = o.paras.flatMap(p => p.runs).find(r => r.text.trim()) ?? o.paras[0]!.runs[0]!;
  const baseStyle: string[] = [];
  if (first.font) {
    baseStyle.push(`font-family:'${first.font.replaceAll('\'', '')}'`);
  }
  if (first.sizePx) {
    baseStyle.push(`font-size:${r1(first.sizePx)}px`);
  }
  baseStyle.push(`font-weight:${first.bold ? 700 : 400}`);
  if (first.italic) {
    baseStyle.push('font-style:italic');
  }
  if (first.underline) {
    baseStyle.push('text-decoration:underline');
  }
  if (first.color) {
    baseStyle.push(`color:#${first.color}`);
  }
  const align = ALIGN[o.paras[0]?.align ?? 'l'] ?? 'left';
  const pad = o.insets.map(v => `${r1(v * ctx.scale)}px`);
  const html = o.paras.map(p => p.runs.map(r => runHtml(r, first)).join('')).join('<br>');
  return `<p style="${geo};box-sizing:border-box;padding:${pad[1]} ${pad[2]} ${pad[3]} ${pad[0]};text-align:${align};${baseStyle.join(';')}${fill}${radius}">${html}</p>`;
}

function convertSlide(id: string, slide: PSlide, ctx: ConvertCtx, w: number, h: number): string {
  const body = slide.objects.filter(o => !o.placeholder || o.paras.some(p => paraText(p).trim())).map(o => convertObject(o, ctx)).filter(Boolean);
  const notes = slide.notes ? `<aside>${slide.notes.split('\n').map(l => `<p>${esc(l)}</p>`).join('')}</aside>` : '';
  const bg = slide.bg ? `background:#${slide.bg};` : '';
  return `<section id="${escAttr(id)}" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;padding:0;margin:0;${bg}">${body.join('')}${notes}</section>`;
}

// ---------------------------------------------------------------------------

function findRoot(html: string, slideId: string): { $: ReturnType<typeof parseLocated>['$']; root: ReturnType<typeof elementAtPath> } {
  const { $ } = parseLocated(html, false);
  const tops = $.root().children().toArray().filter(n => n.type === 'tag');
  const root = tops.find(n => n.attribs.id === slideId) ?? tops.find(n => n.name === 'section') ?? tops[0] ?? null;
  return { $, root: root ?? null };
}

function longestIncreasing(seq: number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = Array.from({ length: seq.length }, () => -1);
  const idx: number[] = [];
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    tails[lo] = v;
    idx[lo] = i;
    prev[i] = lo > 0 ? idx[lo - 1]! : -1;
  });
  const keep = new Set<number>();
  let k = idx.at(tails.length - 1) ?? -1;
  while (k >= 0) {
    keep.add(k);
    k = prev[k]!;
  }
  return keep;
}

const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

/**
 * Merges an edited PPTX back into the deck it was exported from.
 * @param buf - The PPTX file.
 * @param base - The deck as it was when exported (or is now).
 * @returns The merged deck (a new object; `base` is untouched), images found in new or converted slides (referenced as `asset:<key>` in the HTML), and a per-slide report.
 */
export async function pptxToDeck(buf: Buffer, base: DeckFiles): Promise<{ deck: DeckFiles; newAssets: NewAsset[]; report: ImportReportEntry[] }> {
  const zip = await JSZip.loadAsync(buf);
  const pres = parseXml((await readText(zip, 'ppt/presentation.xml')) ?? '');
  const presRoot = pres.find(n => n.tag === 'p:presentation');
  const sldSz = presRoot ? child(presRoot, 'p:sldSz') : undefined;
  const cx = Number(sldSz?.attrs.cx ?? 12192000);
  const cy = Number(sldSz?.attrs.cy ?? 6858000);
  const pxPerEmu = 1920 / cx;
  const height = Math.round(cy * pxPerEmu);
  const presRels = relsOf(await readText(zip, 'ppt/_rels/presentation.xml.rels'), 'ppt');
  const slidePaths = childrenOf(child(presRoot, 'p:sldIdLst'), 'p:sldId')
    .map(s => presRels[s.attrs['r:id'] ?? '']?.target)
    .filter((p): p is string => !!p);

  // Read every slide.
  const slides: Array<{ path: string; slide: PSlide; marker: ReturnType<typeof splitMarker>['marker']; notesBody: string }> = [];
  for (const path of slidePaths) {
    const xml = await readText(zip, path);
    if (!xml) {
      continue;
    }
    const dir = path.slice(0, path.lastIndexOf('/'));
    const rels = relsOf(await readText(zip, `${dir}/_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`), dir);
    const sld = parseXml(xml).find(n => n.tag === 'p:sld')!;
    const cSld = child(sld, 'p:cSld')!;
    const objects: PObject[] = [];
    readShapes(child(cSld, 'p:spTree')!, pxPerEmu, { ox: 0, oy: 0, sx: 1, sy: 1 }, objects);
    const bg = fillColor(child(child(cSld, 'p:bg'), 'p:bgPr'));
    let notesRaw = '';
    const notesRel = Object.values(rels).find(r => r.type.endsWith('/notesSlide'));
    if (notesRel) {
      const nx = await readText(zip, notesRel.target);
      if (nx) {
        const ntree = parseXml(nx).find(n => n.tag === 'p:notes')!;
        const body = descendants(ntree, 'p:sp').find(sp => child(child(child(sp, 'p:nvSpPr'), 'p:nvPr'), 'p:ph')?.attrs.type === 'body');
        notesRaw = childrenOf(child(body, 'p:txBody'), 'a:p').map(p => descendants(p, 'a:t').map(textContent).join('')).join('\n');
      }
    }
    const { notes, marker } = splitMarker(notesRaw);
    const mediaByRid: Record<string, string> = {};
    for (const [rid, r] of Object.entries(rels)) {
      if (r.type.endsWith('/image')) {
        mediaByRid[rid] = r.target;
      }
    }
    slides.push({ path, slide: { objects, bg, notes: normText(notes), mediaByRid }, marker, notesBody: notes });
  }

  // Recognise.
  const claimed = new Set<string>();
  const recognised: Array<string | null> = slides.map(({ slide, marker }) => {
    let id: string | null = null;
    if (marker && base.slides[marker.slideId] !== undefined) {
      id = marker.slideId;
    } else {
      const votes = new Map<string, number>();
      for (const o of slide.objects) {
        const p = parseObjectName(o.name);
        if (p && base.slides[p.slideId] !== undefined) {
          votes.set(p.slideId, (votes.get(p.slideId) ?? 0) + 1);
        }
      }
      id = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    if (id && claimed.has(id)) {
      return null;
    }
    if (id) {
      claimed.add(id);
    }
    return id;
  });

  const newAssets: NewAsset[] = [];
  const assetKeys = new Map<string, string>();
  const outSlides: Record<string, string> = {};
  const order: string[] = [];
  const report: ImportReportEntry[] = [];
  let importedN = 0;
  const survivingBase = base.order.filter(id => claimed.has(id));

  for (const [i, entry] of slides.entries()) {
    const { slide, marker } = entry;
    const id = recognised[i] ?? null;
    const makeCtx = (key: string): ConvertCtx => ({
      slideKey: key,
      slide,
      scale: pxPerEmu,
      assetFor: (rId) => {
        const media = slide.mediaByRid[rId];
        if (!media) {
          return null;
        }
        const known = assetKeys.get(media);
        if (known) {
          return known;
        }
        const ext = media.split('.').pop()!.toLowerCase();
        const k = `${key}-${assetKeys.size + 1}.${ext}`;
        assetKeys.set(media, k);
        return k;
      },
    });
    const harvestAssets = async () => {
      for (const [media, key] of assetKeys) {
        if (newAssets.some(a => a.key === key)) {
          continue;
        }
        const f = zip.file(media);
        if (f && Object.values(slide.mediaByRid).includes(media)) {
          const ext = media.split('.').pop()!.toLowerCase();
          newAssets.push({ key, bytes: await f.async('nodebuffer'), contentType: MEDIA_TYPES[ext] ?? 'application/octet-stream' });
        }
      }
    };

    if (!id) {
      importedN++;
      const newId = `imported-${importedN}`;
      const ctx = makeCtx(newId);
      outSlides[newId] = convertSlide(newId, slide, ctx, 1920, height);
      await harvestAssets();
      order.push(newId);
      report.push({ slideId: newId, status: 'added', details: ['no vocion marker or object names; converted from the file'] });
      continue;
    }

    const html = base.slides[id]!;
    const details: string[] = [];
    const named = new Map<string, PObject>();
    let foreign = 0;
    for (const o of slide.objects) {
      const p = parseObjectName(o.name);
      if (p && p.slideId === id) {
        named.set(`${p.path}${p.suffix ? `~${p.suffix}` : ''}`, o);
      } else if (!o.placeholder || o.paras.some(pp => paraText(pp).trim())) {
        foreign++;
      }
    }
    const missing = marker
      ? [...Object.keys(marker.text), ...marker.other].filter(n => !named.has(n))
      : [];
    let restructure = foreign > 0 || missing.length > 0;
    if (foreign > 0) {
      details.push(`${foreign} object${foreign === 1 ? '' : 's'} added in the file`);
    }
    if (missing.length > 0) {
      details.push(`removed in the file: ${missing.slice(0, 5).join(', ')}`);
    }

    const splices: Splice[] = [];
    if (!restructure) {
      const { $, root } = findRoot(html, id);
      if (!root) {
        restructure = true;
        details.push('base slide has no root element');
      } else {
        for (const [key, obj] of named) {
          if (key.includes('~') || obj.kind !== 'sp' || obj.paras.length === 0) {
            continue;
          }
          const text = objectText(obj);
          const el = elementAtPath(root, key);
          if (!el) {
            if (marker?.text[key] !== undefined && textHash(text) !== marker.text[key]) {
              restructure = true;
              details.push(`${key}: element no longer in the base slide`);
            }
            continue;
          }
          const changed = marker?.text[key] !== undefined
            ? textHash(text) !== marker.text[key]
            : textOfElement(el).toLowerCase() !== text.toLowerCase();
          if (!changed) {
            continue;
          }
          const plan = planTextEdit(el, text);
          if (!plan) {
            restructure = true;
            details.push(`${key}: no source location`);
          } else if (plan.length > 0) {
            splices.push(...plan);
            details.push(`${key}: "${clip(textOfElement(el))}" -> "${clip(text)}"`);
          }
        }
        // Notes.
        const notesChanged = marker ? textHash(slide.notes) !== marker.notes : false;
        if (!restructure && notesChanged) {
          const aside = $('aside').first();
          const node = aside[0];
          const lines = slide.notes.split('\n').filter(Boolean);
          const hasP = aside.find('p').length > 0;
          const inner = hasP ? lines.map(l => `<p>${esc(l)}</p>`).join('') : lines.map(esc).join('<br>');
          if (node?.sourceCodeLocation?.startTag) {
            const loc = node.sourceCodeLocation;
            splices.push({ start: loc.startTag!.endOffset, end: loc.endTag?.startOffset ?? loc.endOffset, insert: inner });
          } else {
            const close = html.lastIndexOf('</section>');
            if (close >= 0) {
              splices.push({ start: close, end: close, insert: `<aside>${lines.map(l => `<p>${esc(l)}</p>`).join('')}</aside>` });
            }
          }
          details.push('notes');
        }
      }
    }

    if (restructure) {
      const ctx = makeCtx(id);
      outSlides[id] = convertSlide(id, slide, ctx, 1920, height);
      await harvestAssets();
      order.push(id);
      report.push({ slideId: id, status: 'converted', details });
      continue;
    }
    outSlides[id] = splices.length ? applySplices(html, splices) : html;
    order.push(id);
    report.push({ slideId: id, status: splices.length ? 'text-edited' : 'kept', details: details.length ? details : undefined });
  }

  // Moved: recognised slides that fall outside the longest in-order run.
  const fileOrderIds = order.filter(id => claimed.has(id));
  const positions = fileOrderIds.map(id => survivingBase.indexOf(id));
  const stay = longestIncreasing(positions);
  fileOrderIds.forEach((id, k) => {
    if (stay.has(k)) {
      return;
    }
    const entry = report.find(r => r.slideId === id);
    if (entry) {
      if (entry.status === 'kept') {
        entry.status = 'moved';
      } else {
        entry.details = [...(entry.details ?? []), 'moved'];
      }
    }
  });

  for (const id of base.order) {
    if (!claimed.has(id)) {
      report.push({ slideId: id, status: 'removed' });
    }
  }

  return { deck: { ...base, order, slides: outSlides }, newAssets, report };
}
