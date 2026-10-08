/**
 * Real PDF and Word files, built in memory for tests, so the readers in
 * `libs/extract` are exercised on the bytes a connector would download rather
 * than on a mock of the parser. Test-only (this folder is outside the unused
 * code check for that reason).
 */

import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A text in a PDF string literal, with its delimiters escaped.
 * @param text - Plain ASCII text.
 */
function pdfString(text: string): string {
  return text.replace(/[\\()]/g, ch => `\\${ch}`);
}

/**
 * A PDF with one page per entry. A page whose entry is empty has no text
 * layer at all, which is what a scanned page looks like to a text reader.
 * @param pages - The text on each page, ASCII.
 */
export function pdfWithPages(pages: string[]): Buffer {
  const objects: string[] = [];
  const fontId = 3 + pages.length * 2;
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${pdfString(text)}) Tj ET` : '';
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/**
 * A zip archive of the given parts, each deflated unless `stored` names it.
 * @param parts - Path to content.
 * @param stored - Paths to keep uncompressed (method 0).
 */
export function zipOf(parts: Record<string, string>, stored: readonly string[] = []): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(parts)) {
    const raw = Buffer.from(content, 'utf8');
    const method = stored.includes(name) ? 0 : 8;
    const data = method === 0 ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * A .docx whose body is the given WordprocessingML (the inside of `w:body`).
 * @param bodyXml - Paragraphs and tables.
 */
export function docxWithBody(bodyXml: string): Buffer {
  return zipOf({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  }, ['[Content_Types].xml']);
}

/**
 * One Word paragraph of plain runs.
 * @param runs - Each run's text.
 */
export function wordParagraph(...runs: string[]): string {
  return `<w:p>${runs.map(text => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`).join('')}</w:p>`;
}
