/**
 * Files a person puts into a chat turn — an image, a PDF, a text file.
 *
 * One noun, no new store (design principle 7): an upload is an ARTIFACT of
 * kind `file`, authored by a human, saved by the same content-addressed
 * store the agent's own files use and served by the same authenticated
 * route. What this module adds is the part that is specific to a turn:
 *
 *   - which files are accepted, and how big (`acceptUpload`);
 *   - what the model receives (`composeUserContent`): an image travels as an
 *     image block; a PDF or text file travels as its TEXT, extracted once at
 *     upload and stored on the artifact's spec, inlined under the message
 *     with the filename on it. Text, not a document block, because the
 *     workspace's agents run on three vendors and text is the one shape all
 *     of them read the same way;
 *   - how a later turn knows the file was there (`historyMarker`): the
 *     persisted user message stays the words the person typed, and the
 *     history replay appends `[Attached: report.pdf]` so the agent knows to
 *     ask rather than guess. The full text is not replayed — it would swamp
 *     the context on every later turn for a file read once.
 *
 * Nothing here decides anything the model should: a file is inlined whole up
 * to a cap, and past the cap the text says it was cut and by how much.
 */

import type { Buffer } from 'node:buffer';
import type { ArtifactRow } from '@/services/ArtifactService';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { artifactsDir } from '@/libs/tools/artifacts/store';

/** What the composer chip and the transcript show — mirrors `features/dashboard/chat/types.ts`. */
export type ChatAttachment = {
  id: number;
  title: string;
  contentType: string;
  bytes: number;
  url: string;
  kind: 'image' | 'document';
};

/** An attachment as the turn needs it: the chip plus what the model gets. */
export type LoadedAttachment = ChatAttachment & {
  /** Extracted text for a document; absent for an image. */
  text?: string;
  /** The stored file's name in the artifacts directory, for reading image bytes. */
  filename?: string;
};

/** Files at or over this many bytes are refused. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Images are sent to the model inline; the vendors cap them around here. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** How many files one message may carry. */
export const MAX_ATTACHMENTS = 10;
/** How much extracted text one document may put in front of the model. */
export const MAX_DOCUMENT_CHARS = 120_000;
/** And how much all of a turn's documents may, together. */
export const MAX_TURN_CHARS = 200_000;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html']);
const EXT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
};

export type AcceptedUpload = {
  contentType: string;
  ext: string;
  kind: 'image' | 'document';
};

/**
 * Decide whether a file may be attached, and as what. The browser's
 * `type` is trusted when it is one we know; otherwise the extension
 * decides, because browsers report `application/octet-stream` for `.md`
 * and friends. Anything else is refused with the reason.
 * @param file - Name, reported type and size.
 * @param file.name
 * @param file.type
 * @param file.size
 */
export function acceptUpload(file: { name: string; type: string; size: number }): { ok: true; accepted: AcceptedUpload } | { ok: false; reason: string } {
  const ext = path.extname(file.name).slice(1).toLowerCase();
  const reported = file.type.split(';')[0]!.trim().toLowerCase();
  const contentType = IMAGE_TYPES.has(reported) || TEXT_TYPES.has(reported) || reported === 'application/pdf'
    ? reported
    : EXT_TYPES[ext];
  if (!contentType) {
    return { ok: false, reason: `${file.name}: images (PNG, JPEG, WebP, GIF), PDFs and text files (TXT, MD, CSV, JSON, HTML) can be attached; this is ${reported || `.${ext}` || 'an unknown type'}.` };
  }
  if (file.size <= 0) {
    return { ok: false, reason: `${file.name} is empty.` };
  }
  const kind: AcceptedUpload['kind'] = IMAGE_TYPES.has(contentType) ? 'image' : 'document';
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `${file.name} is ${mb(file.size)}; an image may be up to ${mb(MAX_IMAGE_BYTES)}.` };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `${file.name} is ${mb(file.size)}; a file may be up to ${mb(MAX_UPLOAD_BYTES)}.` };
  }
  const resolvedExt = ext || Object.entries(EXT_TYPES).find(([, t]) => t === contentType)?.[0] || 'bin';
  return { ok: true, accepted: { contentType, ext: resolvedExt, kind } };
}

function mb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/**
 * The text of a document, for the model. PDFs go through `pdf-parse`; text
 * files are decoded as UTF-8. A PDF with no extractable text (a scan) yields
 * an empty string, and the caller says so rather than sending nothing.
 * @param data - The file's bytes.
 * @param contentType - Its resolved type.
 */
export async function extractText(data: Buffer, contentType: string): Promise<string> {
  if (contentType === 'application/pdf') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const result = await parser.getText();
      return normalise(result.text);
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  return normalise(data.toString('utf8'));
}

function normalise(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The spec an upload's artifact row carries. `text` is the extraction, done
 * once here so a turn never re-parses the file; `originalName` is the name
 * the person had, which the content-addressed filename replaced.
 * @param opts
 * @param opts.filename - The stored (content-addressed) filename.
 * @param opts.originalName - The name the person uploaded.
 * @param opts.contentType - Resolved type.
 * @param opts.bytes - Size.
 * @param opts.url - Authenticated URL.
 * @param opts.text - Extracted text, for documents.
 */
export function uploadSpec(opts: { filename: string; originalName: string; contentType: string; bytes: number; url: string; text?: string }): Record<string, unknown> {
  return {
    filename: opts.filename,
    originalName: opts.originalName,
    contentType: opts.contentType,
    bytes: opts.bytes,
    url: opts.url,
    uploaded: true,
    ...(opts.text !== undefined ? { text: opts.text.slice(0, MAX_DOCUMENT_CHARS * 2) } : {}),
  };
}

/**
 * The chip for an upload's artifact row — the same shape the composer showed
 * before the message was sent, rebuilt from the row on reload.
 * @param row - A `file` artifact.
 */
export function attachmentFromArtifact(row: ArtifactRow): ChatAttachment {
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const contentType = typeof spec.contentType === 'string' ? spec.contentType : 'application/octet-stream';
  return {
    id: row.id,
    title: row.title,
    contentType,
    bytes: typeof spec.bytes === 'number' ? spec.bytes : 0,
    url: `/api/artifacts/${row.id}`,
    kind: IMAGE_TYPES.has(contentType) ? 'image' : 'document',
  };
}

/**
 * Everything the turn needs from an upload row: the chip, the text for a
 * document, the stored filename for an image.
 * @param row - A `file` artifact the person uploaded.
 */
export function loadedFromArtifact(row: ArtifactRow): LoadedAttachment {
  const spec = (row.spec ?? {}) as Record<string, unknown>;
  const base = attachmentFromArtifact(row);
  return {
    ...base,
    ...(base.kind === 'document' && typeof spec.text === 'string' ? { text: spec.text } : {}),
    ...(typeof spec.filename === 'string' ? { filename: spec.filename } : {}),
  };
}

/** One block of the user message as LangChain's chat models take it. */
export type UserContentBlock
  = | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };

/**
 * What the model is handed for a turn with attachments: the message, then
 * each document's text under a header naming the file, then each image as
 * an inline block. The text is capped per document and per turn; a cut says
 * where it happened so the model does not treat a truncated file as whole.
 *
 * With no attachments the result is the message string itself, so a plain
 * turn's input is exactly what it was before.
 * @param message - The person's message, with page context already applied.
 * @param attachments - Loaded uploads.
 * @param readImage - Reads an image's bytes by stored filename; injectable so this composes without a filesystem in tests.
 */
export async function composeUserContent(
  message: string,
  attachments: LoadedAttachment[],
  readImage: (filename: string) => Promise<Buffer | null> = readStoredFile,
): Promise<string | UserContentBlock[]> {
  if (attachments.length === 0) {
    return message;
  }
  const parts: string[] = [message];
  let budget = MAX_TURN_CHARS;
  const images: UserContentBlock[] = [];
  const unreadable: string[] = [];
  for (const a of attachments) {
    if (a.kind === 'document') {
      const text = a.text ?? '';
      if (!text.trim()) {
        parts.push(`--- attached: ${a.title} (${a.contentType}) ---\n(no text could be extracted from this file — a scanned PDF, or an empty file)`);
        continue;
      }
      const allowed = Math.min(MAX_DOCUMENT_CHARS, budget);
      const cut = text.length > allowed;
      const body = cut ? text.slice(0, allowed) : text;
      budget -= body.length;
      parts.push(`--- attached: ${a.title} (${a.contentType}, ${a.bytes} bytes${cut ? `, first ${body.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters — the rest was cut` : ''}) ---\n${body}`);
      continue;
    }
    const bytes = a.filename ? await readImage(a.filename) : null;
    if (!bytes) {
      unreadable.push(a.title);
      continue;
    }
    images.push({ type: 'image_url', image_url: { url: `data:${a.contentType};base64,${bytes.toString('base64')}` } });
  }
  if (images.length > 0) {
    parts.push(`(${images.length === 1 ? 'One image is' : `${images.length} images are`} attached below${attachments.filter(a => a.kind === 'image').map(a => ` — ${a.title}`).join('')}.)`);
  }
  if (unreadable.length > 0) {
    parts.push(`(Attached but unreadable here: ${unreadable.join(', ')}.)`);
  }
  const text = parts.join('\n\n');
  return images.length === 0 ? text : [{ type: 'text', text }, ...images];
}

/**
 * The text-only form of the same composition, for a harness that takes a
 * string (the AWS-managed harness) — images become a note, documents inline.
 * @param message - The person's message.
 * @param attachments - Loaded uploads.
 */
export async function composeUserText(message: string, attachments: LoadedAttachment[]): Promise<string> {
  const composed = await composeUserContent(message, attachments, async () => null);
  if (typeof composed === 'string') {
    return composed;
  }
  return composed.filter((b): b is Extract<UserContentBlock, { type: 'text' }> => b.type === 'text').map(b => b.text).join('\n\n');
}

/**
 * What a LATER turn's history says about a message that carried files: the
 * names, not the contents.
 * @param attachments - The message's uploads.
 */
export function historyMarker(attachments: ReadonlyArray<{ title: string }>): string {
  return attachments.length === 0 ? '' : `\n\n[Attached: ${attachments.map(a => a.title).join(', ')}]`;
}

async function readStoredFile(filename: string): Promise<Buffer | null> {
  // The name is content-addressed and came from our own row, but it is still
  // used as a path: keep it inside the artifacts directory.
  if (!/^[\w.-]+$/.test(filename)) {
    return null;
  }
  try {
    return await readFile(path.join(artifactsDir(), filename));
  } catch {
    return null;
  }
}

/** An attachment as it crosses to the agent-runtime container (`packages/agent-runtime/src/contract.ts`). */
export type WireAttachment = {
  title: string;
  contentType: string;
  /** A document's extracted text. */
  text?: string;
  /** An image's bytes as a data URL. */
  dataUrl?: string;
};

/**
 * Attachments for the container, which has neither the database nor the
 * artifacts volume: documents as their text, images as data URLs read here.
 * @param attachments - Loaded uploads.
 * @param readImage - Injectable for tests.
 */
export async function attachmentsForWire(
  attachments: LoadedAttachment[],
  readImage: (filename: string) => Promise<Buffer | null> = readStoredFile,
): Promise<WireAttachment[]> {
  const out: WireAttachment[] = [];
  for (const a of attachments) {
    if (a.kind === 'document') {
      out.push({ title: a.title, contentType: a.contentType, text: a.text ?? '' });
      continue;
    }
    const bytes = a.filename ? await readImage(a.filename) : null;
    out.push({ title: a.title, contentType: a.contentType, ...(bytes ? { dataUrl: `data:${a.contentType};base64,${bytes.toString('base64')}` } : {}) });
  }
  return out;
}
