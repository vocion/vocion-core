import { describe, expect, it } from 'vitest';
import { applyDocumentOps, DocumentEditError } from './edit';
import { parseSheets } from './sheets';

const sheet = (n: number, label: string, body = '') => `<article class="sheet"><div class="strip"><span class="l">${label}</span></div><div class="body">${body}</div><div class="foot"><div class="pnum">${n} / 3</div></div></article>`;
const doc = `<!doctype html><html><head><title>Old</title><style>.a{}</style></head><body>\n${sheet(1, 'Cover', '<h1>Hi &amp; hello</h1>')}\n${sheet(2, 'Agents', '<p>three agents</p>')}\n${sheet(3, 'Pricing')}\n</body></html>`;

describe('applyDocumentOps', () => {
  it('cut page 2: removes the sheet and renumbers every footer', () => {
    const r = applyDocumentOps(doc, [{ op: 'remove_sheet', n: 2 }]);
    const parsed = parseSheets(r.html);

    expect(parsed.sheets.map(s => s.label)).toEqual(['Cover', 'Pricing']);
    expect(parsed.sheets[1]!.html).toContain('>2 / 2<');
    expect(r.applied).toEqual(['removed sheet 2 (Agents)']);
  });

  it('replace, insert and move keep document order and footers honest', () => {
    const r = applyDocumentOps(doc, [
      { op: 'replace_sheet', n: 2, html: sheet(9, 'Agents v2', '<p>two agents</p>') },
      { op: 'insert_sheet', after: 2, html: sheet(9, 'Measurement') },
      { op: 'move_sheet', n: 4, to: 1 },
    ]);
    const parsed = parseSheets(r.html);

    expect(parsed.sheets.map(s => s.label)).toEqual(['Pricing', 'Cover', 'Agents v2', 'Measurement']);
    expect(parsed.sheets.map(s => /(\d+) \/ (\d+)/.exec(s.html)!.slice(1).join('/'))).toEqual(['1/4', '2/4', '3/4', '4/4']);
    expect(r.applied).toHaveLength(3);
  });

  it('replace_text matches literally, reports a miss, and can be scoped to one sheet', () => {
    const r = applyDocumentOps(doc, [{ op: 'replace_text', find: 'three agents', replace: 'two agents', all: false }]);

    expect(r.html).toContain('two agents');
    expect(() => applyDocumentOps(doc, [{ op: 'replace_text', find: 'nope', replace: 'x', all: false }])).toThrow(DocumentEditError);
    expect(() => applyDocumentOps(doc, [{ op: 'replace_text', find: 'three agents', replace: 'x', all: false, sheet: 1 }])).toThrow(/not found on sheet 1/);

    const all = applyDocumentOps(doc, [{ op: 'replace_text', find: 'sheet', replace: 'page', all: true }]);

    expect(all.applied[0]).toMatch(/×\d+/);
  });

  it('set_title and replace_style touch the head only', () => {
    const r = applyDocumentOps(doc, [{ op: 'set_title', title: 'Acme - Proposal (Metacto) v1.1' }, { op: 'replace_style', css: '.b{}' }]);

    expect(r.html).toContain('<title>Acme - Proposal (Metacto) v1.1</title>');
    expect(r.html).toContain('<style>\n.b{}\n</style>');
    expect(parseSheets(r.html).sheets).toHaveLength(3);
  });

  it('refuses an index that does not exist, and a fragment that is not one sheet', () => {
    expect(() => applyDocumentOps(doc, [{ op: 'remove_sheet', n: 7 }])).toThrow(/sheet 7 does not exist/);
    expect(() => applyDocumentOps(doc, [{ op: 'replace_sheet', n: 1, html: '<p>not a sheet, but long enough to pass the length check</p>' }])).toThrow(/exactly one/);
    expect(() => applyDocumentOps(doc, [])).toThrow(DocumentEditError);
  });
});
