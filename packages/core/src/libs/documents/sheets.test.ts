import { describe, expect, it } from 'vitest';
import { assemble, inspectDocument, outlineText, parseSheets, renumber, sheetLabel } from './sheets';

const doc = `<!doctype html><html><head><title>Acme - Proposal (Metacto) v1.0</title><style>.sheet{}</style></head><body>
<div class="actions"><a href="#" onclick="window.print()">⤓ PDF</a></div>
<article class="sheet">
  <div class="strip"><span class="l">Cover</span><span class="r"><img src="../../deck/logo.svg" alt="m" /></span></div>
  <div class="body"><h1>Acme starts here.</h1></div>
  <div class="foot fsplit"><div class="fnote">Prepared by X</div><div class="pnum">1 / 3</div></div>
</article>
<article class="sheet dense">
  <div class="strip"><span class="l">How it works</span></div>
  <div class="body"><h2>What we build</h2><img src="data:image/png;base64,AAAA" /></div>
  <div class="foot"><div class="pnum">2 / 3</div></div>
</article>
<article class="sheet">
  <div class="body"><h2>Investment &amp; next steps</h2></div>
  <div class="foot"><div class="pnum">3 / 3</div></div>
</article>
<script>console.log(1)</script></body></html>`;

describe('parseSheets', () => {
  it('splits a house-framework document into ordered sheets with labels', () => {
    const parsed = parseSheets(doc);

    expect(parsed.title).toBe('Acme - Proposal (Metacto) v1.0');
    expect(parsed.sheets.map(s => s.label)).toEqual(['Cover', 'How it works', 'Investment & next steps']);
    expect(parsed.before).toContain('⤓ PDF');
    expect(parsed.after).toContain('<script>');
    expect(assemble(parsed).replace(/\s+/g, '')).toBe(doc.replace(/\s+/g, ''));
  });

  it('parses a document with no sheets to zero sheets, never throws', () => {
    const parsed = parseSheets('<html><body><p>hello</p></body></html>');

    expect(parsed.sheets).toHaveLength(0);
    expect(parsed.before).toContain('hello');
  });

  it('labels a sheet from its heading when the strip has no label', () => {
    expect(sheetLabel('<article class="sheet"><h2>Pricing <span class="num">7</span></h2></article>')).toBe('Pricing 7');
  });
});

describe('renumber', () => {
  it('rewrites every footer page number to document order after a cut', () => {
    const parsed = parseSheets(doc);
    const cut = renumber(parsed.sheets.filter(s => s.n !== 2));

    expect(cut.map(s => s.n)).toEqual([1, 2]);
    expect(cut[0]!.html).toContain('<div class="pnum">1 / 2</div>');
    expect(cut[1]!.html).toContain('<div class="pnum">2 / 2</div>');
    // Nothing else in the sheet moved.
    expect(cut[1]!.html).toContain('Investment &amp; next steps');
  });
});

describe('inspectDocument', () => {
  it('reports the outline and the relative assets a sandboxed render cannot load', () => {
    const outline = inspectDocument(doc);

    expect(outline.sheetCount).toBe(3);
    expect(outline.relativeAssets).toEqual(['../../deck/logo.svg']);

    const text = outlineText(outline);

    expect(text).toContain('3 sheets');
    expect(text).toContain('2. How it works');
    expect(text).toContain('unresolved assets');
  });
});
