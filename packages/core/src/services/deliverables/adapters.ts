/**
 * The PPTX and DOCX adapters, wired to the engines (`docs/decks.md`, "Out and
 * back"). The adapters themselves are pure libraries (`libs/decks/pptx/`,
 * `libs/documents/docx/`); this is where they meet the deliverable: the
 * rendered page, the file store, the version history and the export record.
 *
 * Optional by construction: nothing on the path from draft to PDF calls in
 * here, and no core prompt names these formats.
 *
 * Out: the file is filed beside the deliverable as a `file` artifact that
 * carries `exportedFrom` (which deliverable, which version, as what). That is
 * the record of where it went; the deliverable gets no version for a download,
 * because a person exporting has not edited anything.
 *
 * Back: ONE new version through the engine's own revise path (re-rendered,
 * re-audited), with a change summary built from the import report. A stale
 * `baseVersion` — the deliverable's CONTENT changed in Vocion since — is
 * refused with the slide-by-slide (or sheet-by-sheet) diff, exactly as
 * `deck_checkin` refuses it.
 */

import type { Buffer } from 'node:buffer';
import type { DeckSpec, DocumentSpec } from '@/libs/cards/specs';
import type { ImportReportEntry } from '@/libs/decks/pptx/types';
import type { DocumentImportReport } from '@/libs/documents/docx/import';
import type { ArtifactRow, Author } from '@/services/ArtifactService';
import type { DeckVerifyOutcome } from '@/services/decks/DeckEngine';
import type { VerifyOutcome } from '@/services/documents/DocumentEngine';
import JSZip from 'jszip';
import { deckVerificationReceipt } from '@/libs/decks/audit';
import { diffDecks, diffDocuments, diffText, isEmptyDiff } from '@/libs/decks/diff';
import { deckToPptx } from '@/libs/decks/pptx/export';
import { pptxToDeck } from '@/libs/decks/pptx/import';
import { measureSlideLayouts } from '@/libs/decks/pptx/layout';
import { openDeckPage, RENDER_ASSET_ORIGIN } from '@/libs/decks/render';
import { verificationReceipt } from '@/libs/documents/audit';
import { documentToDocx } from '@/libs/documents/docx/export';
import { docxToDocument } from '@/libs/documents/docx/import';
import { stripFramework } from '@/libs/documents/framework';
import { renderAvailable } from '@/libs/documents/render';
import { ArtifactError, getArtifact, getArtifactVersion } from '@/services/ArtifactService';
import { deckAssetLoader, ingestDeckAssets, loadDeck, reviseDeck } from '@/services/decks/DeckEngine';
import { documentTitle, reviseDocument } from '@/services/documents/DocumentEngine';
import { deliverableFilename, fileExport, readStoredFile } from './files';

/** The largest file an import reads. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** What a deck or a document takes back, by kind. */
const KIND_FILE = {
  deck: { format: 'pptx', label: 'a PowerPoint file (.pptx)', marker: 'ppt/presentation.xml' },
  document: { format: 'docx', label: 'a Word file (.docx)', marker: 'word/document.xml' },
} as const;

/** A file an adapter refused, with the sentence a person reads. */
export class AdapterFileError extends Error {
  constructor(public readonly code: 'WRONG_KIND' | 'TOO_LARGE' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'AdapterFileError';
  }
}

/** An exported file: the filed artifact, its link and bytes, and the deliverable version it was made from. */
export type ExportedFile = { file: ArtifactRow; url: string; filename: string; bytes: number; data: Buffer; version: number };

/**
 * Which office file the bytes are, read from the bytes: a zip (`PK\3\4`)
 * holding PowerPoint's or Word's main part. Anything else is `null`.
 * @param buf - The upload.
 */
export async function officeKindOf(buf: Buffer): Promise<'pptx' | 'docx' | 'other-zip' | null> {
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) {
    return null;
  }
  try {
    const zip = await JSZip.loadAsync(buf);
    if (zip.file(KIND_FILE.deck.marker)) {
      return 'pptx';
    }
    if (zip.file(KIND_FILE.document.marker)) {
      return 'docx';
    }
    return 'other-zip';
  } catch {
    return null;
  }
}

/**
 * Refuse, with a sentence, a file that is not what this kind of deliverable takes back.
 * @param kind - The deliverable's kind.
 * @param buf - The upload.
 */
export async function assertImportable(kind: 'deck' | 'document', buf: Buffer): Promise<void> {
  const want = KIND_FILE[kind];
  if (buf.length > MAX_IMPORT_BYTES) {
    throw new AdapterFileError('TOO_LARGE', `That file is ${Math.round(buf.length / 1024 / 1024)} MB; an import can be at most ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  }
  const got = await officeKindOf(buf);
  if (got === want.format) {
    return;
  }
  const what = got === 'pptx' ? 'a PowerPoint file' : got === 'docx' ? 'a Word file' : got === 'other-zip' ? 'a zip that is neither a PowerPoint nor a Word file' : 'not a PowerPoint or Word file';
  throw new AdapterFileError('WRONG_KIND', `That is ${what}; a ${kind} takes back ${want.label}.`);
}

// ─── Decks ⇄ PPTX ──────────────────────────────────────────────────────────

/**
 * Export a deck as a PPTX: render it in the shared Chromium, measure each
 * slide's objects from that very page, write the file, and file it beside the
 * deck. The page is always closed.
 * @param input - Which deck, who exported it.
 * @param input.orgId
 * @param input.id
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function exportDeckPptx(input: { orgId: string; id: number; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }): Promise<ExportedFile> {
  const { row, spec } = await loadDeck(input.orgId, input.id);
  const available = await renderAvailable();
  if (!available.ok) {
    throw new ArtifactError('INVALID_SPEC', `the deck could not be laid out for PowerPoint: the renderer is unavailable (${available.reason})`);
  }
  const loadAsset = deckAssetLoader(input.orgId, spec);
  const { page, close } = await openDeckPage(spec, { loadAsset });
  let data: Buffer;
  try {
    const layouts = await measureSlideLayouts(page, spec.order, {
      // An image the page shows from the file store goes in as its own bytes.
      fetchImage: async (src) => {
        if (!src.startsWith(`${RENDER_ASSET_ORIGIN}/`)) {
          return null;
        }
        const found = await loadAsset(decodeURIComponent(src.slice(RENDER_ASSET_ORIGIN.length + 1)));
        return found ? { bytes: found.body, contentType: found.contentType } : null;
      },
    });
    data = await deckToPptx({ deck: spec, layouts });
  } finally {
    await close();
  }
  const filename = deliverableFilename(spec.title || row.title, 'pptx');
  const { file, url, bytes } = await fileExport({ orgId: input.orgId, source: row, format: 'pptx', data, filename, author: input.author, conversationId: input.conversationId ?? null, visibility: input.visibility ?? 'user' });
  return { file, url, filename, bytes, data, version: row.currentVersion };
}

const PPTX_STATUS_WORDS: Record<ImportReportEntry['status'], string> = {
  'kept': 'kept as it was',
  'text-edited': 'text edited',
  'converted': 'converted from the file (its layout changed)',
  'added': 'added from the file',
  'removed': 'removed',
  'moved': 'moved',
};

/**
 * The import report in plain words: one line per slide that changed, and a count of the rest.
 * @param report - What `pptxToDeck` said.
 * @param order - The deck's order after the import, to number the slides.
 */
export function pptxReportLines(report: ImportReportEntry[], order: string[]): string[] {
  const lines: string[] = [];
  let kept = 0;
  for (const e of report) {
    if (e.status === 'kept') {
      kept += 1;
      continue;
    }
    const n = order.indexOf(e.slideId);
    const where = n >= 0 ? `Slide ${n + 1} (${e.slideId})` : `Slide ${e.slideId}`;
    lines.push(`${where}: ${PPTX_STATUS_WORDS[e.status]}${e.details?.length ? ` — ${e.details.join('; ')}` : ''}.`);
  }
  if (kept > 0) {
    lines.push(`${kept} ${kept === 1 ? 'slide' : 'slides'} kept as ${kept === 1 ? 'it was' : 'they were'}.`);
  }
  return lines;
}

/**
 * One line for the version menu from the report.
 * @param report - What `pptxToDeck` said.
 */
function pptxSummary(report: ImportReportEntry[]): string {
  const count = (s: ImportReportEntry['status']) => report.filter(e => e.status === s).length;
  const parts = (['text-edited', 'converted', 'added', 'removed', 'moved'] as const)
    .map(s => [s, count(s)] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s === 'text-edited' ? 'text edited' : s}`);
  return `Imported from PPTX${parts.length ? `: ${parts.join(', ')}` : ''}`.slice(0, 160);
}

/**
 * The content of a version, for the staleness test, or null when it is gone.
 * @param orgId - The workspace.
 * @param row - The artifact.
 * @param version - Which version.
 */
async function specAt(orgId: string, row: ArtifactRow, version: number): Promise<Record<string, unknown> | null> {
  if (version === row.currentVersion) {
    return row.spec;
  }
  return (await getArtifactVersion({ orgId, artifactId: row.id, version }))?.spec ?? null;
}

export type ImportResult<O, R>
  = | { status: 'stale'; currentVersion: number; diff: string }
    | { status: 'written' | 'unchanged'; artifact: ArtifactRow; version: number; report: R; reportLines: string[]; receipt: string; outcome?: O };

/**
 * Refuse a baseVersion that is ahead of the deliverable or gone; return its content.
 * @param orgId - The workspace.
 * @param row - The deliverable.
 * @param baseVersion - What the file was exported at.
 */
async function baseSpec(orgId: string, row: ArtifactRow, baseVersion: number): Promise<Record<string, unknown>> {
  if (baseVersion > row.currentVersion) {
    throw new ArtifactError('CONFLICT', `baseVersion ${baseVersion} is newer than the ${row.kind} (v${row.currentVersion})`);
  }
  const base = await specAt(orgId, row, baseVersion);
  if (!base) {
    throw new ArtifactError('NOT_FOUND', `version ${baseVersion} of #${row.id} no longer exists; export it again`);
  }
  return base;
}

/**
 * Bring an edited PPTX back as one new version of the deck: merged against the
 * deck as it stands, new pictures stored as deck assets, re-rendered and
 * re-audited by the engine. Refuses a stale `baseVersion` with the diff.
 * @param orgId - The workspace.
 * @param artifactId - The deck.
 * @param buf - The PPTX.
 * @param opts - The version it was exported at, who brought it back, what edited it.
 * @param opts.baseVersion
 * @param opts.author
 * @param opts.runId
 * @param opts.tool - What it was edited in, as the person said (recorded on `origin.tool`).
 * @param opts.onProgress
 */
export async function importDeckPptx(orgId: string, artifactId: number, buf: Buffer, opts: { baseVersion?: number; author: Author; runId?: string | null; tool?: string; onProgress?: (note: string) => void }): Promise<ImportResult<DeckVerifyOutcome, ImportReportEntry[]>> {
  const { row, spec: current } = await loadDeck(orgId, artifactId);
  await assertImportable('deck', buf);
  if (opts.baseVersion !== undefined) {
    const base = await baseSpec(orgId, row, opts.baseVersion) as DeckSpec;
    const moved = diffDecks(base, current);
    if (!isEmptyDiff(moved)) {
      return { status: 'stale', currentVersion: row.currentVersion, diff: diffText(moved) };
    }
  }
  const merged = await pptxToDeck(buf, current);
  const lines = pptxReportLines(merged.report, merged.deck.order);
  const sources = Object.fromEntries(merged.newAssets.map(a => [a.key, { base64: a.bytes.toString('base64'), name: a.key }]));
  const ingested = merged.newAssets.length ? await ingestDeckAssets(orgId, sources) : { assets: {}, errors: [] };
  const assets = { ...(current.assets ?? {}), ...ingested.assets };
  const changed = !isEmptyDiff(diffDecks(current, merged.deck)) || Object.keys(ingested.assets).length > 0;
  if (!changed) {
    return { status: 'unchanged', artifact: row, version: row.currentVersion, report: merged.report, reportLines: lines, receipt: ['Nothing changed: the file matches the deck as it stands.', ...lines].join('\n') };
  }
  const { verification: _v, redTeam: _r, ...rest } = current;
  const { artifact, version, outcome } = await reviseDeck({
    orgId,
    id: artifactId,
    author: opts.author,
    runId: opts.runId ?? null,
    changeSummary: pptxSummary(merged.report),
    deck: {
      ...rest,
      order: merged.deck.order,
      slides: merged.deck.slides,
      ...(Object.keys(assets).length ? { assets } : {}),
      origin: { kind: 'import', tool: opts.tool?.trim() || 'PPTX', baseVersion: opts.baseVersion ?? row.currentVersion },
    },
    ifVersion: row.currentVersion,
    verify: { onProgress: opts.onProgress },
  });
  const warnings = ingested.errors.map(e => `! ${e}`);
  const receipt = [`Imported as v${version.version}.`, ...lines, ...warnings, `Render-verify: ${deckVerificationReceipt(outcome.verification, { images: false })}`].join('\n');
  return { status: 'written', artifact, version: version.version, report: merged.report, reportLines: [...lines, ...warnings], receipt, outcome };
}

// ─── Documents ⇄ DOCX ──────────────────────────────────────────────────────

/**
 * The document a row holds, or a plain error.
 * @param orgId - The workspace.
 * @param id - The artifact.
 */
async function loadDocument(orgId: string, id: number): Promise<{ row: ArtifactRow; spec: Partial<DocumentSpec> }> {
  const row = await getArtifact({ orgId, id });
  if (!row) {
    throw new ArtifactError('NOT_FOUND', `artifact #${id} not found`);
  }
  if (row.kind !== 'document') {
    throw new ArtifactError('INVALID_KIND', `artifact #${id} is a ${row.kind}, not a document`);
  }
  return { row, spec: row.spec as Partial<DocumentSpec> };
}

/**
 * Export a document as a DOCX and file it beside the document.
 * @param input - Which document, who exported it.
 * @param input.orgId
 * @param input.id
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function exportDocumentDocx(input: { orgId: string; id: number; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }): Promise<ExportedFile> {
  const { row, spec } = await loadDocument(input.orgId, input.id);
  const title = documentTitle(spec, row.title);
  const data = await documentToDocx({ html: stripFramework(spec.html ?? ''), title });
  const filename = deliverableFilename(title, 'docx');
  const { file, url, bytes } = await fileExport({ orgId: input.orgId, source: row, format: 'docx', data, filename, author: input.author, conversationId: input.conversationId ?? null, visibility: input.visibility ?? 'user' });
  return { file, url, filename, bytes, data, version: row.currentVersion };
}

/**
 * The DOCX import report in plain words.
 * @param report - What `docxToDocument` said.
 */
export function docxReportLines(report: DocumentImportReport): string[] {
  const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);
  const lines = report.edited.map(e => `Sheet ${e.sheet}: "${clip(e.before)}" → "${clip(e.after)}".`);
  lines.push(`${report.kept} ${report.kept === 1 ? 'paragraph' : 'paragraphs'} kept as ${report.kept === 1 ? 'it was' : 'they were'}.`);
  if (report.unplaced.length > 0) {
    lines.push(`${report.unplaced.length} ${report.unplaced.length === 1 ? 'paragraph' : 'paragraphs'} in the file matched nothing in the document and ${report.unplaced.length === 1 ? 'was' : 'were'} left out:`);
    lines.push(...report.unplaced.slice(0, 20).map(t => `  - "${clip(t)}"`));
  }
  return lines;
}

/**
 * Bring an edited DOCX back as one new version of the document: changed
 * paragraph text applied to the original sheets, re-rendered and re-audited
 * through the document engine. Paragraphs that match nothing are reported and
 * left out, never guessed in. Refuses a stale `baseVersion` with the diff.
 * @param orgId - The workspace.
 * @param artifactId - The document.
 * @param buf - The DOCX.
 * @param opts - The version it was exported at and who brought it back.
 * @param opts.baseVersion
 * @param opts.author
 * @param opts.runId
 * @param opts.onProgress
 */
export async function importDocumentDocx(orgId: string, artifactId: number, buf: Buffer, opts: { baseVersion?: number; author: Author; runId?: string | null; onProgress?: (note: string) => void }): Promise<ImportResult<VerifyOutcome, DocumentImportReport>> {
  const { row, spec } = await loadDocument(orgId, artifactId);
  await assertImportable('document', buf);
  const current = stripFramework(spec.html ?? '');
  if (opts.baseVersion !== undefined) {
    const base = await baseSpec(orgId, row, opts.baseVersion) as Partial<DocumentSpec>;
    const moved = diffDocuments(stripFramework(base.html ?? ''), current);
    if (!isEmptyDiff(moved)) {
      return { status: 'stale', currentVersion: row.currentVersion, diff: diffText(moved) };
    }
  }
  const { html, report } = await docxToDocument(buf, current);
  const lines = docxReportLines(report);
  if (report.edited.length === 0 || html === current) {
    return { status: 'unchanged', artifact: row, version: row.currentVersion, report, reportLines: lines, receipt: ['Nothing changed: no paragraph text differs from the document as it stands.', ...lines].join('\n') };
  }
  const n = report.edited.length;
  const summary = `Imported from DOCX: ${n} ${n === 1 ? 'paragraph' : 'paragraphs'} edited${report.unplaced.length ? `, ${report.unplaced.length} not placed` : ''}`;
  const { artifact, version, outcome } = await reviseDocument({ orgId, id: artifactId, author: opts.author, runId: opts.runId ?? null, changeSummary: summary, html, ifVersion: row.currentVersion, verify: { onProgress: opts.onProgress } });
  const receipt = [`Imported as v${version.version}.`, ...lines, `Render-verify: ${verificationReceipt(outcome.verification, { images: false })}`].join('\n');
  return { status: 'written', artifact, version: version.version, report, reportLines: lines, receipt, outcome };
}

/**
 * The bytes of an uploaded or exported `file` artifact of this workspace.
 * @param orgId - The workspace.
 * @param fileId - The file artifact.
 */
export async function readFileArtifact(orgId: string, fileId: number): Promise<{ row: ArtifactRow; data: Buffer; name: string }> {
  const row = await getArtifact({ orgId, id: fileId });
  const spec = (row?.spec ?? {}) as { url?: unknown; filename?: unknown; originalName?: unknown };
  if (!row || row.kind !== 'file') {
    throw new AdapterFileError('NOT_FOUND', `No file #${fileId} in this workspace.`);
  }
  let data = typeof spec.url === 'string' ? (await readStoredFile(orgId, spec.url))?.body ?? null : null;
  if (!data && typeof spec.filename === 'string') {
    const { readStoredFile: readUpload } = await import('@/services/chat/attachments');
    data = await readUpload(spec.filename);
  }
  if (!data) {
    throw new AdapterFileError('NOT_FOUND', `The stored bytes of file #${fileId} are gone; attach it again.`);
  }
  return { row, data, name: typeof spec.originalName === 'string' ? spec.originalName : row.title };
}
