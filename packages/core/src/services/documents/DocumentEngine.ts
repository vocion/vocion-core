/**
 * The document engine — write, render, read back, fix.
 *
 * A `document` artifact is the paginated HTML a client will read as a PDF.
 * What made the hand-run loop good was never the writing; it was that every
 * write was followed by a render, a numeric audit and a look before anyone
 * called it done. This service makes that mechanical: every create and every
 * revision renders in real Chromium, measures every sheet, prints the PDF,
 * and stores the verdict ON THE VERSION it verified (`spec.verification`), so
 * the pane can say "13 sheets · verified" and the agent reads the same facts
 * back in its receipt.
 *
 * Every write goes through `ArtifactService` — the one door — so a document
 * has the same versions, restore, conflict handling and log as a table.
 */

import type { Buffer } from 'node:buffer';
import type { DocumentSpec, DocumentVerification } from '@/libs/cards/specs';
import type { DocumentOp } from '@/libs/documents/edit';
import type { DocumentOutline } from '@/libs/documents/sheets';
import type { ArtifactRecordScope, ArtifactRow, ArtifactVersionRow, Author } from '@/services/ArtifactService';
import { evaluateDocument, verificationReceipt } from '@/libs/documents/audit';
import { applyDocumentOps } from '@/libs/documents/edit';
import { renderAvailable, renderDocument } from '@/libs/documents/render';
import { inspectDocument, outlineText, parseSheets } from '@/libs/documents/sheets';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { ArtifactError, createArtifact, getArtifact, updateArtifact } from '@/services/ArtifactService';
import { lookAtSheets } from './look';

export type VerifyOptions = {
  /** Take per-sheet screenshots and store them (default true). */
  screenshots?: boolean;
  /** Print the PDF and store it (default true). */
  pdf?: boolean;
  /** Run the vision pass over the sheets (default false — it costs a model call). */
  look?: boolean;
};

export type VerifyOutcome = {
  verification: DocumentVerification;
  outline: DocumentOutline;
  /** The PDF bytes, when printed — for the export tool, so it does not render twice. */
  pdf?: Buffer;
  renderer: 'chromium' | 'unavailable';
  ms: number;
};

/**
 * A stored `document` spec from its parts.
 * @param html
 * @param title
 * @param verification
 * @param playbook
 */
export function documentSpec(html: string, title: string | undefined, verification?: DocumentVerification, playbook?: string): DocumentSpec {
  const outline = inspectDocument(html);
  return {
    ...(title ? { title } : outline.title ? { title: outline.title } : {}),
    html,
    sheets: outline.sheetCount,
    ...(playbook ? { playbook } : {}),
    ...(verification ? { verification } : {}),
  };
}

/**
 * The document's title as the PDF should be named — the `<title>` first,
 * because Chrome offers it as the save name and the house rule puts the
 * version and the codename there; the artifact title otherwise.
 * @param spec
 * @param fallback
 */
export function documentTitle(spec: Partial<DocumentSpec>, fallback: string): string {
  const fromHtml = typeof spec.html === 'string' ? parseSheets(spec.html).title : null;
  return (fromHtml || spec.title || fallback).trim();
}

/**
 * A filename Chrome would produce from the title: no path separators, no control characters.
 * @param title
 */
export function pdfFilename(title: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
  return `${base}.pdf`;
}

/**
 * Render and audit HTML, storing the sheet PNGs and the PDF as served files.
 * Never throws for a document problem; a renderer that cannot launch comes
 * back as a verification that says so, so the write still lands and the
 * receipt is honest about what was and was not checked.
 * @param orgId
 * @param html
 * @param opts
 */
export async function verifyHtml(orgId: string, html: string, opts: VerifyOptions = {}): Promise<VerifyOutcome> {
  const started = Date.now();
  const outline = inspectDocument(html);
  const available = await renderAvailable();
  if (!available.ok) {
    return {
      verification: {
        at: new Date().toISOString(),
        sheets: [],
        footerAligned: false,
        pdfPages: null,
        unresolvedAssets: outline.relativeAssets,
        issues: [`Renderer unavailable (${available.reason}). The document was saved but not render-verified — install Playwright's Chromium on this host.`],
        ok: false,
      },
      outline,
      renderer: 'unavailable',
      ms: Date.now() - started,
    };
  }
  const rendered = await renderDocument(html, { screenshots: opts.screenshots !== false, pdf: opts.pdf !== false });
  const sheets = await Promise.all(rendered.sheets.map(async (s) => {
    const { png, x: _x, y: _y, width: _w, height: _h, ...rest } = s;
    if (!png) {
      return rest;
    }
    const saved = await saveArtifact({ orgId, data: png, ext: 'png', contentType: 'image/png' });
    return { ...rest, image: saved.url };
  }));
  let pdfUrl: string | undefined;
  if (rendered.pdf) {
    pdfUrl = (await saveArtifact({ orgId, data: rendered.pdf, ext: 'pdf', contentType: 'application/pdf' })).url;
  }
  const verification = evaluateDocument({ sheets, pdfPages: rendered.pdfPages, ...(pdfUrl ? { pdf: pdfUrl } : {}), unresolvedAssets: rendered.unresolvedAssets });
  if (opts.look) {
    const withPng = rendered.sheets.filter(s => s.png).map(s => ({ n: s.n, label: s.label, png: s.png! }));
    try {
      const look = await lookAtSheets(orgId, withPng);
      if (look.status === 'looked') {
        for (const f of look.findings) {
          verification.issues.push(`look: sheet ${f.sheet} — ${f.finding}`);
        }
      } else {
        verification.issues.push(`look: skipped — ${look.reason}`);
      }
    } catch (err) {
      verification.issues.push(`look: failed — ${(err as Error).message.split('\n')[0]}`);
    }
    verification.issues = verification.issues.slice(0, 40);
    // A skipped look is not a defect in the document; only real findings flip `ok`.
    verification.ok = verification.issues.every(i => i.startsWith('look: skipped'));
  }
  return { verification, outline, ...(rendered.pdf ? { pdf: rendered.pdf } : {}), renderer: 'chromium', ms: Date.now() - started };
}

export type CreateDocumentInput = {
  orgId: string;
  conversationId?: number | null;
  author: Author;
  visibility?: 'user' | 'system';
  folder?: string | null;
  record?: ArtifactRecordScope | null;
  title?: string;
  html: string;
  /** The playbook that shaped it (`proposal`, `scope`, `partnership-update`…). */
  playbook?: string;
  verify?: VerifyOptions;
};

/**
 * Create a document artifact: verify first, then persist v1 carrying the
 * verification. One version, one verdict.
 * @param input
 */
export async function createDocument(input: CreateDocumentInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; outcome: VerifyOutcome }> {
  const outcome = await verifyHtml(input.orgId, input.html, input.verify);
  const spec = documentSpec(input.html, input.title, outcome.verification, input.playbook);
  const title = input.title?.trim() || spec.title || 'Document';
  const { artifact, version } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'document',
    title,
    spec,
    folder: input.folder ?? null,
    record: input.record ?? null,
    author: input.author,
    visibility: input.visibility ?? 'user',
    changeSummary: `Created · ${outcome.verification.sheets.length || spec.sheets || 0} sheets`,
  });
  return { artifact, version, outcome };
}

export type ReviseDocumentInput = {
  orgId: string;
  id: number;
  author: Author;
  runId?: string | null;
  changeSummary: string;
  /** Either a whole new HTML… */
  html?: string;
  /** …or sheet-level ops applied to the current HTML. */
  ops?: readonly DocumentOp[];
  title?: string | null;
  ifVersion?: number;
  verify?: VerifyOptions;
};

/**
 * Change a document in place: apply the ops (or take the new HTML), verify,
 * and write the next version with its verdict. Throws `ArtifactError` for a
 * missing artifact or a version conflict, `DocumentEditError` for a bad op.
 * @param input
 */
export async function reviseDocument(input: ReviseDocumentInput): Promise<{ artifact: ArtifactRow; version: ArtifactVersionRow; outcome: VerifyOutcome; applied: string[] }> {
  const existing = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!existing) {
    throw new ArtifactError('NOT_FOUND', `artifact #${input.id} not found`);
  }
  if (existing.kind !== 'document') {
    throw new ArtifactError('INVALID_KIND', `artifact #${input.id} is a ${existing.kind}, not a document`);
  }
  const current = (existing.spec as Partial<DocumentSpec>).html ?? '';
  let html = input.html ?? current;
  let applied: string[] = input.html ? ['replaced the whole document'] : [];
  if (input.ops && input.ops.length > 0) {
    const edited = applyDocumentOps(html, input.ops);
    html = edited.html;
    applied = [...applied, ...edited.applied];
  }
  const outcome = await verifyHtml(input.orgId, html, input.verify);
  const prior = existing.spec as Partial<DocumentSpec>;
  const spec = documentSpec(html, input.title ?? prior.title, outcome.verification, prior.playbook);
  const { artifact, version } = await updateArtifact({
    orgId: input.orgId,
    id: input.id,
    title: input.title ?? null,
    spec,
    author: input.author,
    changeSummary: input.changeSummary,
    runId: input.runId ?? null,
    ...(input.ifVersion === undefined ? {} : { ifVersion: input.ifVersion }),
    // An agent's edits are never folded into a person's save, and one
    // revision is one version even when they come seconds apart.
    noCollapse: true,
  });
  return { artifact, version, outcome, applied };
}

/**
 * Re-verify the document as it stands and record the verdict as a system
 * version. Verifying is an event in the document's history — a person can
 * see when it was last checked and what was found.
 * @param input
 * @param input.orgId
 * @param input.id
 * @param input.agentSlug
 * @param input.verify
 */
export async function verifyDocumentArtifact(input: { orgId: string; id: number; agentSlug?: string | null; verify?: VerifyOptions }): Promise<{ artifact: ArtifactRow; outcome: VerifyOutcome }> {
  const existing = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!existing || existing.kind !== 'document') {
    throw new ArtifactError('NOT_FOUND', `document #${input.id} not found`);
  }
  const html = (existing.spec as Partial<DocumentSpec>).html ?? '';
  const outcome = await verifyHtml(input.orgId, html, input.verify);
  const prior = existing.spec as Partial<DocumentSpec>;
  const spec = documentSpec(html, prior.title, outcome.verification, prior.playbook);
  const { artifact } = await updateArtifact({
    orgId: input.orgId,
    id: input.id,
    title: null,
    spec,
    author: { kind: 'system', id: input.agentSlug ? `agent:${input.agentSlug}` : null },
    changeSummary: outcome.verification.ok ? 'Render-verified · no issues' : `Render-verified · ${outcome.verification.issues.length} ${outcome.verification.issues.length === 1 ? 'issue' : 'issues'}`,
    noCollapse: true,
  });
  return { artifact, outcome };
}

/**
 * Print the document to a PDF file artifact named from its `<title>`, with
 * background graphics forced on. Returns the file artifact and the page count.
 * @param input
 * @param input.orgId
 * @param input.id
 * @param input.author
 * @param input.conversationId
 * @param input.visibility
 */
export async function exportDocumentPdf(input: { orgId: string; id: number; author: Author; conversationId?: number | null; visibility?: 'user' | 'system' }): Promise<{ file: ArtifactRow; url: string; filename: string; pages: number | null; bytes: number }> {
  const existing = await getArtifact({ orgId: input.orgId, id: input.id });
  if (!existing || existing.kind !== 'document') {
    throw new ArtifactError('NOT_FOUND', `document #${input.id} not found`);
  }
  const spec = existing.spec as Partial<DocumentSpec>;
  const rendered = await renderDocument(spec.html ?? '', { screenshots: false, pdf: true });
  if (!rendered.pdf) {
    throw new ArtifactError('INVALID_SPEC', 'the PDF could not be printed');
  }
  const saved = await saveArtifact({ orgId: input.orgId, data: rendered.pdf, ext: 'pdf', contentType: 'application/pdf' });
  const filename = pdfFilename(documentTitle(spec, existing.title));
  const { artifact: file } = await createArtifact({
    orgId: input.orgId,
    conversationId: input.conversationId ?? null,
    kind: 'file',
    title: filename,
    spec: { filename: saved.filename, contentType: 'application/pdf', bytes: saved.bytes, url: saved.url },
    url: saved.url,
    record: existing.recordType && existing.recordId ? { type: existing.recordType, id: existing.recordId, role: 'pdf' } : null,
    author: input.author,
    visibility: input.visibility ?? 'user',
    changeSummary: `Printed from "${existing.title}" v${existing.currentVersion}`,
  });
  return { file, url: saved.url, filename, pages: rendered.pdfPages, bytes: saved.bytes };
}

/**
 * The receipt a tool hands the model after a write: the outline, then the
 * audit with the sheet images, then what to do about it.
 * @param outcome
 * @param opts
 * @param opts.images
 */
export function documentReceipt(outcome: VerifyOutcome, opts: { images?: boolean } = {}): string {
  const lines = [outlineText(outcome.outline), '', `Render-verify (${outcome.renderer}, ${Math.round(outcome.ms / 100) / 10}s): ${verificationReceipt(outcome.verification, { images: opts.images ?? true })}`];
  if (!outcome.verification.ok && outcome.renderer === 'chromium') {
    lines.push('', 'Fix what is listed with edit_document (replace_sheet / remove_sheet / replace_text), then read the new receipt. Trim content on an overflowing sheet; never shrink the footer reserve. A document is not done until this reads "no issues".');
  }
  return lines.join('\n');
}
