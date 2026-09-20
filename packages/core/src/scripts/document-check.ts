/**
 * `npx tsx src/scripts/document-check.ts <file.html | fixture:northwind[:overflow]> [--out <dir>]`
 *
 * The render-verify loop from the command line: renders the document in
 * Chromium, prints the audit receipt, and writes one PNG per sheet, a contact
 * sheet of every sheet side by side, and the PDF. What an agent gets from
 * `render_document`, for a person at a terminal.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import sharp from 'sharp';
import { northwindProposal } from '@/libs/documents/__fixtures__/northwind';
import { evaluateDocument, verificationReceipt } from '@/libs/documents/audit';
import { undefinedClasses } from '@/libs/documents/classAudit';
import { proseSheets } from '@/libs/documents/componentAudit';
import { closeRenderer, renderDocument } from '@/libs/documents/render';

async function main() {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--')) ?? 'fixture:northwind';
  const outIx = args.indexOf('--out');
  const out = outIx === -1 ? path.join(process.cwd(), '.artifacts', 'document-check') : args[outIx + 1]!;
  mkdirSync(out, { recursive: true });
  const name = target.startsWith('fixture:') ? target.slice('fixture:'.length).replaceAll(':', '-') : path.basename(target, path.extname(target));
  const html = target === 'fixture:northwind'
    ? northwindProposal()
    : target === 'fixture:northwind:overflow'
      ? northwindProposal({ overflowSheet: true })
      : target === 'fixture:northwind:three'
        ? northwindProposal({ threeAgents: true, pricePerRole: true, version: '1.1' })
        : readFileSync(target, 'utf8');

  const r = await renderDocument(html);
  const v = evaluateDocument({
    sheets: r.sheets.map(({ png: _p, x: _x, y: _y, width: _w, height: _h, ...s }) => s),
    pdfPages: r.pdfPages,
    unresolvedAssets: r.unresolvedAssets,
    undefinedClasses: undefinedClasses(html),
    proseSheets: proseSheets(html),
  });
  console.log(`${name} · ${r.ms}ms\n${verificationReceipt(v)}`);

  const tiles = await Promise.all(r.sheets.filter(s => s.png).map(s => sharp(s.png!).resize({ width: 408 }).png().toBuffer()));
  if (tiles.length > 0) {
    const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
    const w = tiles.length * 420 + 12;
    const h = Math.max(...metas.map(m => m.height ?? 528)) + 24;
    const contact = await sharp({ create: { width: w, height: h, channels: 3, background: '#e9e9e4' } })
      .composite(tiles.map((t, i) => ({ input: t, left: 12 + i * 420, top: 12 })))
      .png()
      .toBuffer();
    writeFileSync(path.join(out, `${name}-contact.png`), contact);
  }
  for (const s of r.sheets) {
    if (s.png) {
      writeFileSync(path.join(out, `${name}-sheet-${s.n}.png`), s.png);
    }
  }
  if (r.pdf) {
    writeFileSync(path.join(out, `${name}.pdf`), r.pdf);
  }
  console.log(`wrote ${out}`);
  await closeRenderer();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
