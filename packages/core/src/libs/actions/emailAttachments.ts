/**
 * Artifacts that go WITH an email: what the review card shows before approval,
 * and the bytes the send carries after it.
 *
 * An email proposal names its attachments by artifact id. A document or a
 * deck goes as its PDF — a document printed by the document engine
 * (`exportDocumentPdf`), a deck as the PDF its last write printed — each filed
 * beside its source, so what was sent is itself an artifact; a file artifact goes as the stored file. The card reads the same rows, so the
 * approver sees each attachment's title, its size or page count, and can open
 * it in the preview panel — and an attachment that cannot go is said on the
 * card before anyone approves, never discovered by the send.
 */

import type { Buffer } from 'node:buffer';
import type { OutboundAttachment } from './types';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSheets } from '@/libs/documents/sheets';
import { artifactsDir } from '@/libs/tools/artifacts/store';
import { isSafeArtifactFilename } from '@/libs/tools/artifacts/url';

/** One file may be this big; Gmail refuses a message over 25 MB once base64 is counted. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** All of them together, raw. Base64 adds a third, which keeps the message under Gmail's 25 MB. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
/** How many artifacts one email may carry. */
export const MAX_ATTACHMENTS = 5;

export type AttachmentRef = { artifactId: number };

/** The bytes a send attaches. */
export type ResolvedAttachment = { artifactId: number; filename: string; contentType: string; data: Buffer };

type ArtifactLike = { id: number; kind: string; title: string; url: string | null; spec: unknown };

/**
 * The stored file a file artifact points at, inside the artifacts directory.
 * @param spec - The file artifact's spec.
 * @param url - Its served url, the filename's fallback.
 */
function storedFilename(spec: Record<string, unknown>, url: string | null): string | null {
  const fromSpec = typeof spec.filename === 'string' ? spec.filename : null;
  const fromUrl = url ? decodeURIComponent(url.split('?')[0]!.split('/').pop() ?? '') : null;
  const name = fromSpec || fromUrl;
  return name && isSafeArtifactFilename(name) ? name : null;
}

/**
 * A size a person reads: "43 KB", "1.2 MB".
 * @param bytes
 */
export function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The PDF a deck's last write printed and stored (`verification.pdf`): every
 * deck write renders and prints, so the current deck already has one, and the
 * send attaches it rather than rendering again.
 * @param spec - The deck's spec.
 */
function deckPdfUrl(spec: Record<string, unknown>): string | null {
  const v = spec.verification as { pdf?: unknown } | undefined;
  return typeof v?.pdf === 'string' && v.pdf ? v.pdf : null;
}

/**
 * What the card shows for one artifact: its title, what it goes as, and why
 * it cannot go when it cannot. Pure, so the card and a test read the same rule.
 * @param ref - The artifact the proposal named.
 * @param row - The artifact, or null when the workspace has no such artifact.
 */
export function describeAttachment(ref: AttachmentRef, row: ArtifactLike | null): OutboundAttachment {
  const href = `/dashboard/artifacts/${ref.artifactId}`;
  if (!row) {
    return { artifactId: ref.artifactId, title: `Artifact #${ref.artifactId}`, href, problem: 'Not found in this workspace, so it cannot be attached.' };
  }
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  if (row.kind === 'document') {
    const html = typeof spec.html === 'string' ? spec.html : '';
    const pages = parseSheets(html).sheets.length;
    if (!html.trim()) {
      return { artifactId: row.id, title: row.title, href, problem: 'This document has no content to print.' };
    }
    return { artifactId: row.id, title: row.title, href, meta: pages > 0 ? `PDF · ${pages} page${pages === 1 ? '' : 's'}` : 'PDF' };
  }
  if (row.kind === 'deck') {
    const order = Array.isArray(spec.order) ? spec.order.length : 0;
    if (order === 0) {
      return { artifactId: row.id, title: row.title, href, problem: 'This deck has no slides to print.' };
    }
    if (!deckPdfUrl(spec)) {
      return { artifactId: row.id, title: row.title, href, problem: 'This deck has no printed PDF yet. Verify it, then attach it.' };
    }
    return { artifactId: row.id, title: row.title, href, meta: `PDF · ${order} slide${order === 1 ? '' : 's'}` };
  }
  if (row.kind === 'file') {
    const bytes = typeof spec.bytes === 'number' ? spec.bytes : null;
    if (!storedFilename(spec, row.url)) {
      return { artifactId: row.id, title: row.title, href, problem: 'The stored file is missing, so it cannot be attached.' };
    }
    if (bytes !== null && bytes > MAX_ATTACHMENT_BYTES) {
      return { artifactId: row.id, title: row.title, href, meta: sizeLabel(bytes), problem: `Larger than ${sizeLabel(MAX_ATTACHMENT_BYTES)}, so it cannot be attached. Share its link instead.` };
    }
    return { artifactId: row.id, title: row.title, href, ...(bytes !== null ? { meta: sizeLabel(bytes) } : {}) };
  }
  return { artifactId: row.id, title: row.title, href, problem: `A ${row.kind} cannot be attached; only documents, decks and files can. Link to it instead.` };
}

/**
 * The card's attachment list for a proposal.
 * @param orgId - The workspace.
 * @param refs - The proposal's `attachments`.
 */
export async function describeAttachments(orgId: string, refs: readonly AttachmentRef[] | undefined): Promise<OutboundAttachment[]> {
  if (!refs || refs.length === 0) {
    return [];
  }
  const { getArtifact } = await import('@/services/ArtifactService');
  const rows = await Promise.all(refs.map(r => getArtifact({ orgId, id: r.artifactId }).catch(() => null)));
  return refs.map((r, i) => describeAttachment(r, rows[i] as ArtifactLike | null));
}

/**
 * The bytes to attach, at send time. Throws with a sentence a person can act
 * on when one cannot go; nothing is sent then.
 * @param orgId - The workspace.
 * @param refs - The approved input's `attachments`.
 * @param author - Who the printed PDF is filed under.
 * @param author.kind
 * @param author.id
 */
export async function resolveAttachments(orgId: string, refs: readonly AttachmentRef[] | undefined, author: { kind: 'human' | 'agent' | 'system'; id?: string | null }): Promise<ResolvedAttachment[]> {
  if (!refs || refs.length === 0) {
    return [];
  }
  const { getArtifact } = await import('@/services/ArtifactService');
  const out: ResolvedAttachment[] = [];
  for (const ref of refs) {
    const row = await getArtifact({ orgId, id: ref.artifactId });
    const described = describeAttachment(ref, row as ArtifactLike | null);
    if (described.problem || !row) {
      throw new Error(`Attachment "${described.title}": ${described.problem ?? 'not found.'}`);
    }
    let file: ArtifactLike = row as ArtifactLike;
    let filename = row.title;
    if (row.kind === 'document') {
      const { exportDocumentPdf } = await import('@/services/documents/DocumentEngine');
      const printed = await exportDocumentPdf({ orgId, id: row.id, author, visibility: 'system' });
      file = printed.file as ArtifactLike;
      filename = printed.filename;
    } else if (row.kind === 'deck') {
      // The PDF the deck's last write printed, filed beside the deck as what was sent.
      const { filePdf, pdfFilename, readStoredFile } = await import('@/services/deliverables/files');
      const spec = (row.spec ?? {}) as Record<string, unknown>;
      const stored = await readStoredFile(orgId, deckPdfUrl(spec) ?? '');
      if (!stored) {
        throw new Error(`Attachment "${row.title}": its printed PDF is missing. Verify the deck, then send again.`);
      }
      filename = pdfFilename(typeof spec.title === 'string' && spec.title ? spec.title : row.title);
      const filed = await filePdf({ orgId, source: row, pdf: stored.body, filename, author, visibility: 'system' });
      file = filed.file as ArtifactLike;
    }
    const spec = (file.spec ?? {}) as Record<string, unknown>;
    const stored = storedFilename(spec, file.url);
    if (!stored) {
      throw new Error(`Attachment "${row.title}": the stored file is missing.`);
    }
    const data = await readFile(path.join(artifactsDir(), stored));
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${row.title}" is ${sizeLabel(data.byteLength)}, over the ${sizeLabel(MAX_ATTACHMENT_BYTES)} limit. Share its link instead.`);
    }
    const contentType = typeof spec.contentType === 'string' ? spec.contentType : 'application/octet-stream';
    out.push({ artifactId: row.id, filename: /\.[a-z0-9]{2,5}$/i.test(filename) ? filename : `${filename}${path.extname(stored)}`, contentType, data });
  }
  const total = out.reduce((n, a) => n + a.data.byteLength, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`The attachments come to ${sizeLabel(total)}, over the ${sizeLabel(MAX_TOTAL_ATTACHMENT_BYTES)} an email can carry. Attach fewer, or share links.`);
  }
  return out;
}
