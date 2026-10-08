import { describe, expect, it } from 'vitest';
import { cleanSvgCss, sanitizeSvg } from './svg';

/**
 * An uploaded logo is served publicly and shown before sign-in, so what is
 * kept is a picture and nothing more: scripts, handlers, embedded pages and
 * anything that reaches outside the file are taken out.
 */

const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY lol "lol">]>
<svg viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <style>.a{fill:url(https://evil.example/x)} .b{fill:url(#g)} @import url(https://evil.example/c.css);</style>
  <a href="javascript:alert(3)"><path class="a" d="M0 0h10v10z"/></a>
  <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
  <use href="https://evil.example/s.svg#x"/>
  <use xlink:href="#g"/>
  <linearGradient id="g"><stop offset="0" stop-color="#0e8c7f"/></linearGradient>
  <image href="https://evil.example/p.png"/>
  <rect fill="url(https://evil.example/f)" width="1" height="1" style="fill:url(http://evil.example);stroke:#12355b" onclick="x()"/>
</svg>`;

describe('sanitizeSvg', () => {
  it('keeps the drawing and drops everything that runs or reaches outside', () => {
    const out = sanitizeSvg(HOSTILE)!;

    expect(out).toMatch(/^<svg /);
    expect(out).not.toMatch(/script|onload|onclick|foreignObject|javascript|evil\.example|ENTITY|DOCTYPE|<\?xml|<image|@import/i);
    // The drawing, the gradient and same-file references survive.
    expect(out).toContain('<path class="a" d="M0 0h10v10z">');
    expect(out).toContain('<linearGradient id="g">');
    expect(out).toContain('xlink:href="#g"');
    expect(out).toContain('.b{fill:url(#g)}');
    expect(out).toContain('stroke:#12355b');
  });

  it('declares the namespaces an image needs to render', () => {
    const out = sanitizeSvg('<svg viewBox="0 0 1 1"><use xlink:href="#a"/></svg>')!;

    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it('refuses what is not an SVG', () => {
    expect(sanitizeSvg('<html><body>not a logo</body></html>')).toBeNull();
    expect(sanitizeSvg('')).toBeNull();
  });

  it('cleans CSS of every way out', () => {
    expect(cleanSvgCss('a{background:url( "https://x.example/a.png" )} b{fill:url(\'#ok\')} @import "x.css"; c{width:expression(alert(1))}')).toBe('a{background:none} b{fill:url(\'#ok\')}  c{width:(alert(1))}');
  });
});
