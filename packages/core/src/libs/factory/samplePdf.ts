/**
 * A real one-page PDF of about `bytes`: a catalog, one page that says it is a
 * sample, a cross-reference table, padded after the header with a comment. A
 * product that opens what it is given (StampSend renders a document's pages)
 * needs a PDF a reader can open; a padded header and an end marker was
 * refused. The same shape the runner's QA flows upload (`packages/runner/src/qa.mjs`),
 * here for the live browser's `browser_upload` (Chris, 2026-10-04: the expiry
 * demo "doesn't quite show it all happening. Like there's no pdf upload").
 */
import { Buffer } from 'node:buffer';

/** The most a sample may weigh. */
export const SAMPLE_PDF_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The PDF, as bytes.
 * @param bytes - The size wanted; the smallest valid file when smaller than that.
 * @param text - The one line on the page.
 */
export function samplePdf(bytes: number, text = 'Sample file for a demo'): Buffer {
  const words = String(text).replace(/[()\\\r\n]/g, ' ').slice(0, 80);
  const stream = `BT /F1 24 Tf 72 700 Td (${words}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const build = (padding: string): string => {
    let out = `%PDF-1.4\n${padding}`;
    const offsets: number[] = [];
    objects.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  };
  const bare = build('');
  const want = Math.min(SAMPLE_PDF_MAX_BYTES, Math.max(0, Math.floor(bytes)));
  const room = Math.max(0, want - bare.length);
  // A comment line is "%", the filler, "\n"; the offsets grow by the padding's own length, which build() accounts for.
  const padding = room > 2 ? `%${'x'.repeat(room - 2)}\n` : '';
  return Buffer.from(build(padding), 'latin1');
}
