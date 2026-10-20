import type { Author } from '@/services/ArtifactService';
import { exportFilename, extractTables, toXlsx } from '@/libs/artifacts/tableExport';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { ArtifactError, createArtifact, getArtifact } from '@/services/ArtifactService';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * File an artifact's tables as an .xlsx file artifact beside it — what an
 * agent hands a person who asked for "the numbers in a spreadsheet". The same
 * workbook the header's download serves (`/api/artifacts/:id/tables`); filing
 * it makes it a thing the conversation shows, attaches and links, like the PDF.
 * @param input - Org, the artifact, who exports, and where the file lands.
 * @param input.orgId
 * @param input.id
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function exportArtifactXlsx(input: { orgId: string; id: number; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }) {
  const existing = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!existing) {
    throw new ArtifactError('NOT_FOUND', `artifact #${input.id} not found`);
  }
  const tables = extractTables({ kind: existing.kind, title: existing.title, spec: existing.spec });
  if (tables.length === 0) {
    throw new ArtifactError('INVALID_SPEC', `“${existing.title}” has no tables to export`);
  }
  const data = await toXlsx(tables);
  const saved = await saveArtifact({ orgId: input.orgId, data, ext: 'xlsx', contentType: XLSX_TYPE });
  const filename = exportFilename(existing.title, 'xlsx');
  const { artifact: file } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'file',
    title: filename,
    spec: { filename: saved.filename, contentType: XLSX_TYPE, bytes: saved.bytes, url: saved.url },
    url: saved.url,
    record: existing.recordType && existing.recordId ? { type: existing.recordType, id: existing.recordId, role: 'spreadsheet' } : null,
    author: input.author,
    visibility: input.visibility ?? 'user',
    changeSummary: `Tables from "${existing.title}" v${existing.currentVersion}`,
  });
  return { file, url: saved.url, filename, sheets: tables.map(t => t.name), bytes: saved.bytes };
}
