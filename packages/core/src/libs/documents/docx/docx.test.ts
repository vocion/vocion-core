import type { Buffer } from 'node:buffer';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { documentToDocx } from './export';
import { docxToDocument, similarity } from './import';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Northwind - Proposal</title><style>.sheet{width:8.5in}</style></head>
<body>
<article class="sheet">
  <div class="strip"><span class="l">Overview</span></div>
  <div class="body">
    <h1>Northwind starts here</h1>
    <p>We built the intake flow for <b>Kestrel Capital</b> in six weeks, then handed it to the <a href="https://example.com/larkfield">Larkfield Systems</a> team.</p>
    <p style="color:#1C6D69">Every record has to exist before anything can read it.</p>
    <ul>
      <li>Orders are up eleven percent</li>
      <li>Returns are down <i>two points</i></li>
    </ul>
    <img src="data:image/png;base64,${PNG_1PX}" alt="Acme mark" width="120" height="120">
  </div>
  <div class="foot"><div class="pnum">1 / 2</div></div>
</article>
<article class="sheet">
  <div class="body">
    <h2>What Contoso Supply gets</h2>
    <p>Three deliverables, each with an owner and a date that both teams agreed in writing before work began.</p>
    <table>
      <thead><tr><th>Deliverable</th><th>Owner</th></tr></thead>
      <tbody>
        <tr><td>Intake flow</td><td>Dana Reyes</td></tr>
        <tr><td>Reporting pack</td><td>Sam Okafor</td></tr>
      </tbody>
    </table>
    ${'<div>'.repeat(16)}<p>A paragraph buried sixteen levels deep in wrapper markup.</p>${'</div>'.repeat(16)}
  </div>
  <div class="foot"><div class="pnum">2 / 2</div></div>
</article>
</body></html>`;

async function edit(buf: Buffer, fn: (xml: string) => string): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  zip.file('word/document.xml', fn(await zip.file('word/document.xml')!.async('string')));
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('DOCX adapter', () => {
  it('writes sections, headings, bookmarks, tables, links and images', async () => {
    const buf = await documentToDocx({ html: HTML, title: 'Northwind - Proposal' });
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml.match(/<w:sectPr/g)).toHaveLength(2);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('w:name="vocion_1_1_1"');
    expect(xml).toContain('w:name="vocion_1_1_3_0"');
    // The deep path is over 40 characters as plain text and is hashed.
    expect(xml).toMatch(/w:name="vocion_2_h[0-9a-f]{12}"/);

    // Every bookmark name is valid and at most 40 characters.
    for (const m of xml.matchAll(/<w:bookmarkStart [^>]*w:name="([^"]+)"/g)) {
      expect(m[1]).toMatch(/^\w{1,40}$/);
    }

    // The pinned footer is Word's job, not ours.
    expect(xml).not.toContain('1 / 2');
  });

  it('round trip with no edits returns the document unchanged', async () => {
    const buf = await documentToDocx({ html: HTML, title: 'Northwind - Proposal' });
    const back = await docxToDocument(buf, HTML);

    expect(back.html).toBe(HTML);
    expect(back.report.edited).toEqual([]);
    expect(back.report.unplaced).toEqual([]);
    // strip label, h1, 2 p, 2 li, h2, p, 6 cells, deep p
    expect(back.report.kept).toBe(15);
  });

  it('an edited paragraph comes back at its element and nothing else changes', async () => {
    const buf = await documentToDocx({ html: HTML, title: 'x' });
    const edited = await edit(buf, xml => xml.replace('Returns are down ', 'Returns are down by ').replace('Reporting pack', 'Reporting bundle'));
    const back = await docxToDocument(edited, HTML);

    expect(back.report.edited).toEqual([
      { sheet: 1, path: '1.3.1', before: 'Returns are down two points', after: 'Returns are down by two points' },
      { sheet: 2, path: '0.2.1.1.0', before: 'Reporting pack', after: 'Reporting bundle' },
    ]);
    expect(back.html).toBe(HTML.replace('Returns are down <i>two points</i>', 'Returns are down by <i>two points</i>').replace('Reporting pack', 'Reporting bundle'));
  });

  it('keeps inline structure when the edit sits inside one node and flattens when it spans nodes', async () => {
    const buf = await documentToDocx({ html: HTML, title: 'x' });
    const inside = await docxToDocument(await edit(buf, xml => xml.replace('Kestrel Capital', 'Kestrel Partners')), HTML);

    expect(inside.html).toContain('<b>Kestrel Partners</b>');
    expect(inside.html).toContain('<a href="https://example.com/larkfield">Larkfield Systems</a>');

    const spanning = await docxToDocument(await edit(buf, xml => xml.replace('Kestrel Capital', 'Kestrel Partners').replace('Larkfield Systems', 'Larkfield Labs')), HTML);

    expect(spanning.report.edited).toHaveLength(1);
    expect(spanning.html).toContain('<p>We built the intake flow for Kestrel Partners in six weeks, then handed it to the Larkfield Labs team.</p>');
  });

  it('places a paragraph whose bookmark was dropped by similarity, and lists the rest as unplaced', async () => {
    const buf = await documentToDocx({ html: HTML, title: 'x' });
    const edited = await edit(buf, (xml) => {
      const noBookmarks = xml.replace(/<w:bookmarkStart [^>]*\/>/g, '').replace(/<w:bookmarkEnd [^>]*\/>/g, '');
      return noBookmarks
        .replace('Every record has to exist before anything can read it.', 'Every record has to exist before anything can read it today.')
        .replace('</w:body>', '<w:p><w:r><w:t>A paragraph that Acme added in Word with no counterpart anywhere in the source.</w:t></w:r></w:p></w:body>');
    });
    // Body-level sectPr must stay last in w:body; the injected paragraph goes before it.
    const fixed = await edit(edited, xml => xml.replace(/(<w:sectPr(?:(?!<w:sectPr)[\s\S])*<\/w:sectPr>)(<w:p><w:r><w:t>A paragraph that Acme[\s\S]*?<\/w:p>)/, '$2$1'));
    const back = await docxToDocument(fixed, HTML);

    expect(back.report.edited).toEqual([
      { sheet: 1, path: '1.2', before: 'Every record has to exist before anything can read it.', after: 'Every record has to exist before anything can read it today.' },
    ]);
    expect(back.report.unplaced).toEqual(['A paragraph that Acme added in Word with no counterpart anywhere in the source.']);
    expect(back.html).not.toContain('Acme added');
    expect(back.html).toContain('<p style="color:#1C6D69">Every record has to exist before anything can read it today.</p>');
  });

  it('similarity is symmetric to case and rejects different paragraphs', () => {
    expect(similarity('Hello there, friend', 'hello THERE, friend')).toBe(1);
    expect(similarity('The record has to exist first.', 'Prices are listed in the second table below.')).toBe(0);
    expect(similarity('Three deliverables with an owner each', 'Three deliverables with an owner each.')).toBeGreaterThan(0.9);
  });
});
