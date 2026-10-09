/**
 * Small, fictional Office files built in code, for tests.
 *
 * The repo is public, so no real export can be checked in as a fixture; each
 * test builds the file it reads. The cast is the shared fixture cast
 * (`libs/fixtures/realDataGuard.ts`): Northwind, Kestrel Capital, Contoso
 * Supply, Bellwater Hall, Larkfield Systems. Addresses are at `.example`.
 *
 * Test-only. Nothing in the app imports it.
 */

import { Buffer } from 'node:buffer';

const COMPANIES = ['Northwind', 'Kestrel Capital', 'Contoso Supply', 'Bellwater Hall', 'Larkfield Systems'];
const STAGES = ['New', 'Contacted', 'Qualified', 'Won', 'Lost'];

/**
 * A lead list: `count` rows of fictional leads, deterministic.
 * @param count - How many leads.
 */
export function leadRows(count: number): string[][] {
  const rows: string[][] = [['Name', 'Company', 'Email', 'Stage', 'Deal size']];
  for (let i = 1; i <= count; i += 1) {
    const company = COMPANIES[i % COMPANIES.length]!;
    rows.push([
      `Lead ${String(i).padStart(3, '0')}`,
      company,
      `lead${i}@${company.toLowerCase().replace(/\s+/g, '')}.example`,
      STAGES[i % STAGES.length]!,
      String(1000 * ((i % 7) + 1)),
    ]);
  }
  return rows;
}

/**
 * A workbook in any SheetJS-writable format.
 * @param sheets - Sheet name → rows (header first).
 * @param bookType - `xlsx`, `xlsm`, `biff8` (.xls) or `ods`.
 */
export async function workbook(sheets: Record<string, Array<Array<string | number>>>, bookType: 'xlsx' | 'xlsm' | 'biff8' | 'ods' = 'xlsx'): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }) as Uint8Array);
}

async function zip(files: Record<string, string>): Promise<Buffer> {
  const { zipSync, strToU8 } = await import('fflate');
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Word document: a title, two headings, a list, a table. */
export async function docx(): Promise<Buffer> {
  const p = (text: string, style?: string, list = false) =>
    `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${esc(t)}</w:t></w:r></w:p></w:tc>`;
  const body = [
    p('Northwind renewal plan', 'Title'),
    p('Background', 'Heading1'),
    `<w:p><w:r><w:t xml:space="preserve">Northwind has bought from Contoso Supply </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>since 2021</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>`,
    p('Risks', 'Heading2'),
    p('Budget moves to Q3', undefined, true),
    p('A new buyer at Kestrel Capital', undefined, true),
    `<w:tbl><w:tr>${cell('Owner')}${cell('Due')}</w:tr><w:tr>${cell('Bellwater Hall')}${cell('2026-11-03')}</w:tr></w:tbl>`,
  ].join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  });
}

/** An OpenDocument text: a heading, a paragraph, a list. */
export async function odt(): Promise<Buffer> {
  return zip({
    'mimetype': 'application/vnd.oasis.opendocument.text',
    'content.xml': `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text>`
      + `<text:h text:outline-level="1">Bellwater Hall booking</text:h>`
      + `<text:p>Two<text:s text:c="1"/>nights for Larkfield Systems.</text:p>`
      + `<text:list><text:list-item><text:p>Dinner for 40</text:p></text:list-item></text:list>`
      + `</office:text></office:body></office:document-content>`,
  });
}

/** A three-slide deck with a title on each slide and notes on the second. */
export async function pptx(): Promise<Buffer> {
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const shape = (text: string, ph?: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${text.split('\n').map(l => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  const slide = (title: string, body: string) => `<?xml version="1.0"?><p:sld ${ns}><p:cSld><p:spTree>${shape(title, 'title')}${shape(body)}${shape('7', 'sldNum')}</p:spTree></p:cSld></p:sld>`;
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (inner: string) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
  // Deliberately out of file order: the deck's order is the presentation's, not the file names'.
  return zip({
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels(rel('rId1', 'slide', 'slides/slide1.xml') + rel('rId2', 'slide', 'slides/slide2.xml') + rel('rId3', 'slide', 'slides/slide3.xml')),
    'ppt/slides/slide3.xml': slide('Kestrel Capital — Q4 review', 'Agenda\nPipeline'),
    'ppt/slides/slide1.xml': slide('Pipeline', 'Northwind: Qualified\nContoso Supply: Won'),
    'ppt/slides/_rels/slide1.xml.rels': rels(rel('rId9', 'notesSlide', '../notesSlides/notesSlide1.xml')),
    'ppt/notesSlides/notesSlide1.xml': `<?xml version="1.0"?><p:notes ${ns}><p:cSld><p:spTree>${shape('', 'sldImg')}${shape('Mention the renewal date.')}${shape('2', 'sldNum')}</p:spTree></p:cSld></p:notes>`,
    'ppt/slides/slide2.xml': slide('Next steps', 'Send the proposal'),
  });
}

/** An OpenDocument presentation with two pages. */
export async function odp(): Promise<Buffer> {
  const page = (name: string, title: string, body: string) => `<draw:page draw:name="${name}"><draw:frame><draw:text-box><text:p>${esc(title)}</text:p></draw:text-box></draw:frame><draw:frame><draw:text-box><text:p>${esc(body)}</text:p></draw:text-box></draw:frame></draw:page>`;
  return zip({
    'mimetype': 'application/vnd.oasis.opendocument.presentation',
    'content.xml': `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:presentation>${page('p1', 'Welcome', 'Larkfield Systems onboarding')}${page('p2', 'Timeline', 'Kickoff on Monday')}</office:presentation></office:body></office:document-content>`,
  });
}

/** A plain-text email from Contoso Supply to Northwind. */
export function eml(): Buffer {
  return Buffer.from([
    'From: Dana Reyes <dana@contososupply.example>',
    'To: Sam Ito <sam@northwind.example>',
    'Subject: Revised quote',
    'Date: Mon, 05 Oct 2026 09:30:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hi Sam,',
    '',
    'The revised quote is 12,400 for the first year.',
    '',
    'Dana',
  ].join('\r\n'));
}

/** An Outlook .msg: a compound file holding the subject, sender and body as MAPI property streams. */
export async function msg(): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const CFB = XLSX.CFB as { utils: { cfb_new: () => unknown; cfb_add: (c: unknown, p: string, d: Buffer) => void }; write: (c: unknown, o: { type: 'buffer' }) => Uint8Array };
  const cfb = CFB.utils.cfb_new();
  const utf16 = (s: string) => Buffer.from(s, 'utf16le');
  // Unicode string properties: subject, body, sender name, sender address.
  const props: Array<[string, string]> = [
    ['0037', 'Bellwater Hall hold'],
    ['1000', 'We are holding the ballroom for Kestrel Capital until Friday.'],
    ['0C1A', 'Alex Morgan'],
    ['0C1F', 'alex@bellwaterhall.example'],
  ];
  // The property stream: a 32-byte header, then one 16-byte entry per property.
  const header = Buffer.alloc(32);
  const entries = props.map(([tag, value]) => {
    const e = Buffer.alloc(16);
    e.writeUInt16LE(0x001F, 0);
    e.writeUInt16LE(Number.parseInt(tag, 16), 2);
    e.writeUInt32LE(6, 4);
    e.writeUInt32LE(utf16(value).length + 2, 8);
    return e;
  });
  CFB.utils.cfb_add(cfb, '/__properties_version1.0', Buffer.concat([header, ...entries]));
  for (const [tag, value] of props) {
    CFB.utils.cfb_add(cfb, `/__substg1.0_${tag}001F`, utf16(value));
  }
  return Buffer.from(CFB.write(cfb, { type: 'buffer' }));
}
