import sanitizeHtml from 'sanitize-html';

/**
 * AN UPLOADED LOGO IS A PICTURE, NOTHING MORE.
 *
 * An SVG is a document: it can carry a script, an event handler, an embedded
 * HTML page (`foreignObject`), a link that runs JavaScript, or a reference
 * that fetches from another server. A logo is shown on the sign-in page to
 * people who have not signed in, and served at a public URL, so the file kept
 * is rebuilt from an allowlist of drawing elements and attributes: shapes,
 * paths, gradients, text, clip paths and masks, `<use>` of an id in the same
 * file, and `<style>` with every `url()` that is not a same-file `#id`, every
 * `@import` and every `expression()` taken out. Everything else is dropped,
 * comments and processing instructions included, and a file that is not an
 * SVG once that is done is refused.
 *
 * The route that serves it adds a Content-Security-Policy that forbids
 * scripts anyway (`app/api/media/brand/…`); this is the first wall, that is
 * the second.
 */

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'use',
  'symbol',
  'title',
  'desc',
  'style',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feBlend',
  'feColorMatrix',
  'feFlood',
  'feComposite',
  'feMerge',
  'feMergeNode',
];

const SVG_ATTRIBUTES = [
  'id',
  'class',
  'style',
  'xmlns',
  'xmlns:xlink',
  'version',
  'viewBox',
  'preserveAspectRatio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'd',
  'points',
  'pathLength',
  'transform',
  'fill',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'clip-path',
  'clipPathUnits',
  'mask',
  'maskUnits',
  'maskContentUnits',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'href',
  'xlink:href',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'display',
  'visibility',
  'xml:space',
  'filter',
  'filterUnits',
  'stdDeviation',
  'dx',
  'dy',
  'in',
  'in2',
  'result',
  'mode',
  'type',
  'values',
  'operator',
  'flood-color',
  'flood-opacity',
  'color-interpolation-filters',
  'mix-blend-mode',
  'isolation',
];

/**
 * CSS with nothing in it that can reach outside the file or run code: every
 * `@import`, `expression(`, `javascript:`, `behavior:` and every `url()` that
 * is not `url(#id)` removed.
 * @param css - A `<style>` body or a `style` attribute.
 */
export function cleanSvgCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript\s*:/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .replace(/url\s*\(([^)]*)\)/gi, (whole, inner: string) => (/^['"]?#/.test(inner.trim()) ? whole : 'none'))
    .replace(/<\/?\s*style/gi, '');
}

/**
 * A logo SVG rebuilt from the allowlist, or null when nothing drawable is left.
 * @param source - The file as uploaded or fetched.
 */
export function sanitizeSvg(source: string): string | null {
  // Only the <svg> element itself: no prolog, no DOCTYPE (whose internal
  // subset is where entity expansion attacks live), nothing after it.
  const start = source.search(/<svg[\s>]/i);
  const end = source.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < start) {
    return null;
  }
  const body = sanitizeHtml(source.slice(start, end + '</svg>'.length), {
    allowedTags: SVG_TAGS,
    allowedAttributes: { '*': SVG_ATTRIBUTES },
    // `style` is kept on purpose (exported logos colour their paths with
    // classes). sanitize-html passes its text through untouched, so it is
    // cleaned below, after the tree is rebuilt.
    allowVulnerableTags: true,
    allowedSchemes: [],
    allowedSchemesAppliedToAttributes: [],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'textarea', 'option', 'noscript', 'foreignObject', 'iframe'],
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false, recognizeSelfClosing: true },
    transformTags: {
      '*': (tagName, attribs) => {
        const kept: Record<string, string> = {};
        for (const [name, value] of Object.entries(attribs)) {
          if (name === 'href' || name === 'xlink:href') {
            // Only a reference to something in this same file.
            if (/^#[\w.:-]+$/.test(value.trim())) {
              kept[name] = value.trim();
            }
            continue;
          }
          if (name === 'style') {
            kept[name] = cleanSvgCss(value);
            continue;
          }
          // A presentation attribute pointing outside the file (`fill="url(https://…)"`).
          if (/url\s*\(/i.test(value) && !/url\s*\(\s*['"]?#/i.test(value)) {
            continue;
          }
          kept[name] = value;
        }
        return { tagName, attribs: kept };
      },
    },
  }).trim();
  // Each <style> body: nothing that reaches outside, and nothing that can end
  // the element or start markup (escaped for XML, which decodes it back).
  const cleaned = body.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_m, open: string, css: string, close: string) => `${open}${cleanSvgCss(css).replace(/&(?![a-z]+;|#\d+;)/gi, '&amp;').replace(/</g, '&lt;')}${close}`);
  if (!/^<svg[\s>]/.test(cleaned) || !/<\/svg>\s*$/.test(cleaned)) {
    return null;
  }
  // An SVG served as an image needs its namespaces declared to render at all.
  let out = /^<svg[^>]*\sxmlns=/.test(cleaned) ? cleaned : cleaned.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (out.includes('xlink:') && !/^<svg[^>]*\sxmlns:xlink=/.test(out)) {
    out = out.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }
  return out;
}
