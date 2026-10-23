import type { NextRequest } from 'next/server';
import type { Buffer } from 'node:buffer';
import type { DeckSpec, DocumentSpec } from '@/libs/cards/specs';
import { NextResponse } from 'next/server';
import { ArtifactError } from '@/services/ArtifactService';
import { exportDeckPdf, redTeamDeckArtifact } from '@/services/decks/DeckEngine';
import { exportDeckPptx, exportDocumentDocx } from '@/services/deliverables/adapters';
import { SHEET_UNIT, SLIDE_UNIT } from '@/services/deliverables/exportGate';
import { EXPORT_FORMATS, readStoredFile } from '@/services/deliverables/files';
import { gateExport } from '@/services/deliverables/gate';
import { exportDocumentPdf, redTeamDocumentArtifact } from '@/services/documents/DocumentEngine';
import { attachmentDisposition, deliverableFor, noStore, refuse } from '../_shared';

export const maxDuration = 300;

/**
 * `GET /api/deliverables/:artifactId/export?format=pdf|pptx|docx` — the
 * pane's Download. Streams the file as an attachment named from the title,
 * and files it beside the deliverable as a `file` artifact that records which
 * version went out as what (`exportedFrom`); the deck or document itself gets
 * no version for a download.
 *
 * `pdf` works for both kinds; `pptx` is for a deck, `docx` for a document.
 * A PDF goes through the export gate as the person's own ask: a client-facing
 * deliverable nobody has read is read as the buyer first, and a blocking
 * finding comes back as advice in `X-Vocion-Advice` (URI-encoded), never as a
 * refusal (CLAUDE.md, accelerate, never block).
 *
 * Errors are `{ ok: false, reason }`: 404 for a deliverable this caller cannot
 * open, 400 for a format that does not fit the kind, 422 when it cannot be
 * produced (with why).
 * @param req - The request.
 * @param ctx - The route params.
 * @param ctx.params - `{ artifactId }`.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await ctx.params;
  const found = await deliverableFor(req, artifactId);
  if (found instanceof NextResponse) {
    return found;
  }
  const { orgId, author, row } = found;
  const format = req.nextUrl.searchParams.get('format') ?? 'pdf';
  if (format !== 'pdf' && format !== 'pptx' && format !== 'docx') {
    return refuse(400, 'format must be pdf, pptx or docx.');
  }
  if ((format === 'pptx' && row.kind !== 'deck') || (format === 'docx' && row.kind !== 'document')) {
    return refuse(400, `A ${row.kind} downloads as PDF or ${row.kind === 'deck' ? 'PPTX' : 'DOCX'}, not ${format.toUpperCase()}.`);
  }

  let advice: string | null = null;
  let filename: string;
  let data: Buffer | null;
  try {
    if (format === 'pdf') {
      const spec = row.spec as Partial<DeckSpec & DocumentSpec>;
      const gate = await gateExport({
        orgId,
        playbook: spec.playbook ?? null,
        redTeam: spec.redTeam ?? null,
        unit: row.kind === 'deck' ? SLIDE_UNIT : SHEET_UNIT,
        onPersonsWord: true,
        readNow: () => (row.kind === 'deck' ? redTeamDeckArtifact({ orgId, id: row.id }) : redTeamDocumentArtifact({ orgId, id: row.id })),
      });
      // On the person's word the gate never refuses; a refusal here would be a gate bug, and the person still gets their PDF.
      advice = gate.line;
      const res = row.kind === 'deck'
        ? await exportDeckPdf({ orgId, id: row.id, author })
        : await exportDocumentPdf({ orgId, id: row.id, author });
      filename = res.filename;
      data = (await readStoredFile(orgId, res.url))?.body ?? null;
    } else {
      const res = format === 'pptx'
        ? await exportDeckPptx({ orgId, id: row.id, author })
        : await exportDocumentDocx({ orgId, id: row.id, author });
      filename = res.filename;
      data = res.data;
    }
  } catch (err) {
    if (err instanceof ArtifactError) {
      return refuse(422, `The ${format.toUpperCase()} could not be made: ${err.message}.`);
    }
    console.error('[deliverables/export] failed', row.id, format, err);
    return refuse(500, `The ${format.toUpperCase()} could not be made. Try again in a moment.`);
  }
  if (!data) {
    return refuse(500, `The ${format.toUpperCase()} was made but could not be read back. Try again.`);
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      ...noStore,
      'Content-Type': EXPORT_FORMATS[format].contentType,
      'Content-Disposition': attachmentDisposition(filename),
      'Content-Length': String(data.length),
      ...(advice ? { 'X-Vocion-Advice': encodeURIComponent(advice) } : {}),
    },
  });
}
