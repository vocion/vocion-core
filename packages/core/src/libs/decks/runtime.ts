/**
 * Vocion's element runtime — the small browser script that turns a slide's
 * three Vocion elements into inline SVG, so a deck needs no outside runtime
 * to render (`docs/decks.md`).
 *
 *   - `<x-icon name="Lock">` → the icon's SVG from `window.__VOCION_ICONS`
 *     (the render page inlines only the icons the deck uses), sized from the
 *     element's inline width/height (default 48px), stroked in its colour.
 *   - `<x-shape kind="…">` → an SVG filling the element's box; the element's
 *     own background becomes the fill and its border the stroke, so a shape is
 *     styled like any other box. Children stay on top of it.
 *   - `<x-connector x1 y1 x2 y2>` → a line in SLIDE coordinates, whatever
 *     element it sits in, routed `straight`, `hv` or `vh`, with heads at
 *     `end` (default), `start`, `both` or `none`; colour, width and dash from
 *     its inline `color`, `border-width` and `border-style`.
 *
 * Anything it cannot draw is marked `data-vocion-unknown="icon:<name>"`
 * (`shape:<kind>`, `connector:<why>`, `element:<tag>`) and drawn as a dashed
 * red box, never left blank — the audit reads the attribute and names it.
 * Everything it adds carries `data-vocion-generated`, so the audit's element
 * count is the author's. When done it sets
 * `document.documentElement.dataset.vocionRuntime = "ready"`.
 *
 * Deterministic: no network, no randomness, no timers.
 */

/** The tags the runtime accepts, mirrored from `slides.ts` so the browser half and the static half agree. */
import { SHAPE_KINDS, SLIDE_ELEMENTS, SVG_ELEMENTS } from './slides';

const SOURCE = String.raw`(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var ICONS = window.__VOCION_ICONS || {};
  var ALLOWED = __ALLOWED__;
  var SVG_TAGS = __SVG__;
  var SHAPES = __SHAPES__;
  function key(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function px(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) { if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, String(attrs[k])); }
    return e;
  }
  function unknown(el, what) {
    el.setAttribute('data-vocion-unknown', what);
    el.style.outline = '3px dashed #d0021b';
    el.style.outlineOffset = '-3px';
    if (!el.style.minWidth) el.style.minWidth = '48px';
    if (!el.style.minHeight) el.style.minHeight = '48px';
    if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-block';
  }
  function slideOf(el) { return el.closest('section'); }
  function scaleOf(section) { var r = section.getBoundingClientRect(); return r.width > 0 ? r.width / 1920 : 1; }

  function icon(el) {
    var name = el.getAttribute('name') || '';
    var inner = ICONS[key(name)];
    var w = px(el.style.width, NaN), h = px(el.style.height, NaN);
    if (!isFinite(w) && !isFinite(h)) { w = 48; h = 48; } else if (!isFinite(w)) { w = h; } else if (!isFinite(h)) { h = w; }
    el.style.display = el.style.display || 'inline-block';
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.style.lineHeight = '0';
    el.style.flex = el.style.flex || '0 0 auto';
    if (!inner) { unknown(el, 'icon:' + (name || '(no name)')); return; }
    var sw = el.getAttribute('stroke-width') || el.style.getPropertyValue('--stroke-width') || '2';
    el.innerHTML = '<svg data-vocion-generated xmlns="' + NS + '" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  function shapePath(kind, w, h, inset) {
    var x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset, cw = x1 - x0, ch = y1 - y0;
    var mx = x0 + cw / 2, my = y0 + ch / 2;
    function poly(pts) { return 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L') + ' Z'; }
    if (kind === 'diamond') return poly([[mx, y0], [x1, my], [mx, y1], [x0, my]]);
    if (kind === 'arrow-right' || kind === 'arrow-left') {
      var head = Math.min(cw * 0.45, ch), t = ch * 0.25;
      var r = kind === 'arrow-right'
        ? [[x0, y0 + t], [x1 - head, y0 + t], [x1 - head, y0], [x1, my], [x1 - head, y1], [x1 - head, y1 - t], [x0, y1 - t]]
        : [[x1, y0 + t], [x0 + head, y0 + t], [x0 + head, y0], [x0, my], [x0 + head, y1], [x0 + head, y1 - t], [x1, y1 - t]];
      return poly(r);
    }
    if (kind === 'arrow-up' || kind === 'arrow-down') {
      var hd = Math.min(ch * 0.45, cw), s = cw * 0.25;
      var q = kind === 'arrow-down'
        ? [[x0 + s, y0], [x0 + s, y1 - hd], [x0, y1 - hd], [mx, y1], [x1, y1 - hd], [x1 - s, y1 - hd], [x1 - s, y0]]
        : [[x0 + s, y1], [x0 + s, y0 + hd], [x0, y0 + hd], [mx, y0], [x1, y0 + hd], [x1 - s, y0 + hd], [x1 - s, y1]];
      return poly(q);
    }
    return null;
  }

  function shape(el) {
    var kind = (el.getAttribute('kind') || '').toLowerCase();
    var cs = getComputedStyle(el);
    if (cs.display === 'inline') el.style.display = 'block';
    if (cs.position === 'static') el.style.position = 'relative';
    if (!SHAPES[kind]) { unknown(el, 'shape:' + (kind || '(no kind)')); return; }
    var scale = scaleOf(slideOf(el) || el);
    var box = el.getBoundingClientRect();
    var w = Math.max(1, box.width / scale), h = Math.max(1, box.height / scale);
    var fill = cs.backgroundColor;
    var bg = cs.backgroundImage;
    var sw = parseFloat(cs.borderTopWidth) || 0;
    var stroke = sw > 0 && cs.borderTopStyle !== 'none' ? cs.borderTopColor : 'none';
    var dash = cs.borderTopStyle === 'dashed' ? (sw * 3) + ' ' + (sw * 2) : cs.borderTopStyle === 'dotted' ? sw + ' ' + sw : null;
    var radius = parseFloat(cs.borderTopLeftRadius) || 0;
    // The box keeps its size and padding; its paint moves into the SVG.
    el.style.background = 'transparent';
    el.style.border = '0 solid transparent';
    el.style.borderRadius = '0';
    var children = Array.prototype.slice.call(el.childNodes);
    var svg = svgEl('svg', { 'data-vocion-generated': '', width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, style: 'position:absolute;left:0;top:0;overflow:visible;pointer-events:none;z-index:0' });
    var inset = sw / 2, node;
    var paint = { fill: fill, stroke: stroke, 'stroke-width': sw || null, 'stroke-dasharray': dash };
    if (kind === 'line') {
      var vertical = h > w;
      node = svgEl('line', vertical ? { x1: w / 2, y1: 0, x2: w / 2, y2: h } : { x1: 0, y1: h / 2, x2: w, y2: h / 2 });
      node.setAttribute('stroke', stroke !== 'none' ? stroke : (fill && fill !== 'rgba(0, 0, 0, 0)' ? fill : cs.color));
      node.setAttribute('stroke-width', String(sw || Math.max(2, vertical ? w : h)));
      if (dash) node.setAttribute('stroke-dasharray', dash);
    } else if (kind === 'ellipse') {
      node = svgEl('ellipse', Object.assign({ cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset) }, paint));
    } else if (kind === 'rect' || kind === 'rounded') {
      var rx = kind === 'rounded' ? (radius || Math.min(w, h) * 0.18) : radius;
      node = svgEl('rect', Object.assign({ x: inset, y: inset, width: Math.max(0, w - sw), height: Math.max(0, h - sw), rx: rx, ry: rx }, paint));
    } else {
      node = svgEl('path', Object.assign({ d: shapePath(kind, w, h, inset), 'stroke-linejoin': 'round' }, paint));
    }
    if (bg && bg !== 'none' && kind !== 'line') {
      // A gradient background is kept on a clipped box behind the outline, so it is not lost.
      var fo = svgEl('foreignObject', { x: 0, y: 0, width: w, height: h });
      var div = document.createElement('div');
      div.style.cssText = 'width:100%;height:100%;background-image:' + bg + ';clip-path:path("' + (node.getAttribute('d') || '') + '")';
      if (node.tagName !== 'path') div.style.clipPath = kind === 'ellipse' ? 'ellipse(50% 50%)' : (kind === 'rounded' || radius ? 'inset(0 round ' + (kind === 'rounded' ? (radius || Math.min(w, h) * 0.18) : radius) + 'px)' : 'none');
      fo.appendChild(div);
      svg.appendChild(fo);
      node.setAttribute('fill', 'none');
    }
    svg.appendChild(node);
    el.style.backgroundImage = 'none';
    el.insertBefore(svg, el.firstChild);
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.nodeType === 1 && getComputedStyle(c).position === 'static') { c.style.position = 'relative'; c.style.zIndex = '1'; }
      else if (c.nodeType === 3 && c.textContent.trim()) {
        var span = document.createElement('span');
        span.setAttribute('data-vocion-generated', '');
        span.style.position = 'relative';
        span.style.zIndex = '1';
        el.insertBefore(span, c);
        span.appendChild(c);
      }
    }
  }

  function connector(el) {
    var x1 = parseFloat(el.getAttribute('x1')), y1 = parseFloat(el.getAttribute('y1')), x2 = parseFloat(el.getAttribute('x2')), y2 = parseFloat(el.getAttribute('y2'));
    var section = slideOf(el);
    if (!section) { unknown(el, 'connector:outside a slide'); return; }
    if (![x1, y1, x2, y2].every(isFinite)) { unknown(el, 'connector:missing x1 y1 x2 y2'); return; }
    var head = (el.getAttribute('head') || 'end').toLowerCase();
    var route = (el.getAttribute('route') || 'straight').toLowerCase();
    if (['end', 'start', 'both', 'none'].indexOf(head) < 0) { unknown(el, 'connector:head ' + head); return; }
    if (['straight', 'hv', 'vh'].indexOf(route) < 0) { unknown(el, 'connector:route ' + route); return; }
    var cs = getComputedStyle(el);
    var color = el.style.color || cs.color || '#111';
    var width = px(el.style.borderWidth || el.style.borderTopWidth, 3);
    var style = (el.style.borderStyle || el.style.borderTopStyle || 'solid').split(' ')[0];
    var dash = style === 'dashed' ? (width * 3) + ' ' + (width * 2) : style === 'dotted' ? width + ' ' + (width * 1.5) : null;
    // Slide coordinates, whatever the element sits in: place the overlay, then
    // pull it back by however far its containing block is from the slide's corner.
    el.style.cssText += ';position:absolute;left:0;top:0;width:1920px;height:1080px;border:0;padding:0;margin:0;pointer-events:none;display:block;background:none';
    var scale = scaleOf(section);
    var sr = section.getBoundingClientRect(), er = el.getBoundingClientRect();
    el.style.left = ((sr.left - er.left) / scale) + 'px';
    el.style.top = ((sr.top - er.top) / scale) + 'px';
    var d = route === 'hv' ? 'M' + x1 + ' ' + y1 + ' H' + x2 + ' V' + y2 : route === 'vh' ? 'M' + x1 + ' ' + y1 + ' V' + y2 + ' H' + x2 : 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
    var svg = svgEl('svg', { 'data-vocion-generated': '', width: 1920, height: 1080, viewBox: '0 0 1920 1080', style: 'position:absolute;left:0;top:0;overflow:visible' });
    var size = Math.max(10, width * 4);
    var id = 'vh' + Math.round(x1) + '_' + Math.round(y1) + '_' + Math.round(x2) + '_' + Math.round(y2) + '_' + (++seq);
    if (head !== 'none') {
      var defs = svgEl('defs', {});
      var marker = svgEl('marker', { id: id, viewBox: '0 0 10 10', refX: 8, refY: 5, markerUnits: 'userSpaceOnUse', markerWidth: size, markerHeight: size, orient: 'auto-start-reverse' });
      marker.appendChild(svgEl('path', { d: 'M0 0 L10 5 L0 10 Z', fill: color }));
      defs.appendChild(marker);
      svg.appendChild(defs);
    }
    var path = svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': head === 'none' ? 'round' : 'butt' });
    if (head === 'end' || head === 'both') path.setAttribute('marker-end', 'url(#' + id + ')');
    if (head === 'start' || head === 'both') path.setAttribute('marker-start', 'url(#' + id + ')');
    svg.appendChild(path);
    el.innerHTML = '';
    el.appendChild(svg);
  }

  var seq = 0;
  function run() {
    var sections = document.querySelectorAll('section');
    for (var s = 0; s < sections.length; s++) {
      var all = sections[s].querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i], tag = el.tagName.toLowerCase();
        if (el.closest('[data-vocion-generated]')) continue;
        var inSvg = tag !== 'svg' && el.parentElement && el.parentElement.closest('svg');
        if (inSvg ? !SVG_TAGS[tag] : !ALLOWED[tag]) unknown(el, 'element:' + tag);
      }
    }
    var icons = document.querySelectorAll('x-icon');
    for (var a = 0; a < icons.length; a++) icon(icons[a]);
    var shapes = document.querySelectorAll('x-shape');
    for (var b = 0; b < shapes.length; b++) shape(shapes[b]);
    var connectors = document.querySelectorAll('x-connector');
    for (var c = 0; c < connectors.length; c++) connector(connectors[c]);
    document.documentElement.setAttribute('data-vocion-runtime', 'ready');
  }
  // After the fonts: a shape is sized from its box, and the box moves when a webfont swaps in.
  function start() { var f = document.fonts && document.fonts.ready; if (f && f.then) f.then(run, run); else run(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();`;

function asSet(values: Iterable<string>): string {
  return JSON.stringify(Object.fromEntries([...values].map(v => [v, 1])));
}

/**
 * The runtime as one self-contained script body (no `<script>` tags). The
 * page sets `window.__VOCION_ICONS` before it.
 */
export const DECK_RUNTIME: string = SOURCE
  .replace('__ALLOWED__', asSet(SLIDE_ELEMENTS))
  .replace('__SVG__', asSet(SVG_ELEMENTS))
  .replace('__SHAPES__', asSet(SHAPE_KINDS));
