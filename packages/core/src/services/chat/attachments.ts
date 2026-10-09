/**
 * Files a person puts into a chat turn — an image, a PDF, an Office file, an
 * email, a text file.
 *
 * One noun, no new store (design principle 7): an upload is an ARTIFACT of
 * kind `file`, authored by a human, saved by the same content-addressed
 * store the agent's own files use and served by the same authenticated
 * route. What this module adds is the part that is specific to a turn:
 *
 *   - which files are accepted, and how big (`acceptUpload`, with the formats
 *     and the plain-language refusals in `libs/chat/attachmentFormats.ts`);
 *   - what the model receives (`composeUserContent`): an image travels as an
 *     image block; every other file travels as TEXT, converted once at upload
 *     (`./convert.ts`) and stored on the artifact's spec, inlined under the
 *     message with the filename on it. A spreadsheet is summarised — columns,
 *     row count, first rows — and the header names the file's id, which
 *     `read_attachment` takes to read, filter or count every row of the
 *     stored original. Text, not a document block, because the workspace's
 *     agents run on three vendors and text is the one shape all of them read
 *     the same way;
 *   - how a later turn knows the file was there (`historyMarker`): the
 *     persisted user message stays the words the person typed, and the
 *     history replay appends `[Attached: report.pdf (file #12)]` so the agent
 *     can read it again rather than guess. The full text is not replayed — it
 *     would swamp the context on every later turn for a file read once.
 *
 * Nothing here decides anything the model should: a file is inlined whole up
 * to a cap, and past the cap the text says it was cut and by how much.
 */

import type { Buffer } from 'node:buffer';
import type { Conversion } from './convert';
import type { ArtifactRow } from '@/services/ArtifactService';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ATTACHMENT_FORMATS, formatBytes, formatOf, refusalFor } from '@/libs/chat/attachmentFormats';
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

export { MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_UPLOAD_BYTES } from '@/libs/chat/attachmentFormats';
/** How much extracted text one document may put in front of the model. */
export const MAX_DOCUMENT_CHARS = 120_000;
/** And how much all of a turn's documents may, together. */
export const MAX_TURN_CHARS = 200_000;

const IMAGE_TYPES = new Set(ATTACHMENT_FORMATS.filter(f => f.kind === 'image').map(f => f.contentType));

export type AcceptedUpload = {
  contentType: string;
  ext: string;
  kind: 'image' | 'document';
};

/**
 * Decide whether a file may be attached, and as what. The extension decides
 * first and the reported type second (`formatOf`), because browsers report
 * `application/octet-stream` for `.md`, `.msg` and friends. A refusal is one
 * plain sentence for the person — never a MIME type
 * (`libs/chat/attachmentFormats.ts`).
 * @param file - Name, reported type and size.
 * @param file.name
 * @param file.type
 * @param file.size
 */
export function acceptUpload(file: { name: string; type: string; size: number }): { ok: true; accepted: AcceptedUpload } | { ok: false; reason: string } {
  const refusal = refusalFor(file);
  const format = formatOf(file);
  if (refusal || !format) {
    return { ok: false, reason: refusal ?? `Vocion can't read ${file.name}.` };
  }
  return { ok: true, accepted: { contentType: format.contentType, ext: format.ext, kind: format.kind } };
}

/**
 * Read an upload once, for the model: a PDF's or text file's text, a
 * spreadsheet summarised sheet by sheet, a document with its headings, a deck
 * slide by slide, an email's headers and body (`./convert.ts`). Office files
 * also report their shape — sheets with row counts and columns, or a slide
 * count — which is stored on the artifact so a later tool call can name a
 * sheet without parsing the file again.
 * @param data - The file's bytes.
 * @param file - Its name and resolved type.
 * @param file.name
 * @param file.contentType
 */
export async function convertUpload(data: Buffer, file: { name: string; contentType: string }): Promise<Conversion> {
  const format = formatOf({ name: file.name, type: file.contentType });
  if (!format || format.kind === 'image') {
    return { text: '' };
  }
  const { convertForModel } = await import('./convert');
  return convertForModel(data, format);
}

/**
 * The text of a document, for the model — `convertUpload` without the shape.
 * A PDF with no extractable text (a scan) yields an empty string, and the
 * caller says so rather than sending nothing.
 * @param data - The file's bytes.
 * @param contentType - Its resolved type.
 * @param name - Its name, which settles the format when the type is shared (a CSV and a TSV).
 */
export async function extractText(data: Buffer, contentType: string, name = ''): Promise<string> {
  return (await convertUpload(data, { name, contentType })).text;
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
 * @param opts.sheets - A spreadsheet's sheets: names, row counts, columns.
 * @param opts.slides - A deck's slide count.
 */
export function uploadSpec(opts: { filename: string; originalName: string; contentType: string; bytes: number; url: string; text?: string; sheets?: Conversion['sheets']; slides?: number }): Record<string, unknown> {
  return {
    filename: opts.filename,
    originalName: opts.originalName,
    contentType: opts.contentType,
    bytes: opts.bytes,
    url: opts.url,
    uploaded: true,
    ...(opts.text !== undefined ? { text: opts.text.slice(0, MAX_DOCUMENT_CHARS * 2) } : {}),
    // The shape, without the data: sheet names, row counts and columns. The
    // rows stay in the stored original, which `read_attachment` reads.
    ...(opts.sheets ? { sheets: opts.sheets.slice(0, 50).map(s => ({ name: s.name, rows: s.rows, columns: s.columns.slice(0, 200) })) } : {}),
    ...(opts.slides !== undefined ? { slides: opts.slides } : {}),
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
        parts.push(`--- attached: ${a.title} (${describe(a)}) ---\n(no text could be extracted from this file — a scanned PDF, or an empty file)`);
        continue;
      }
      const allowed = Math.min(MAX_DOCUMENT_CHARS, budget);
      const cut = text.length > allowed;
      const body = cut ? text.slice(0, allowed) : text;
      budget -= body.length;
      parts.push(`--- attached: ${a.title} (${describe(a)}${cut ? `, first ${body.length.toLocaleString('en-US')} of ${text.length.toLocaleString('en-US')} characters — the rest was cut` : ''}) ---\n${body}`);
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
 * How the header under the message names a file for the model: what it is,
 * how big, and how to read all of it. The id is what `read_attachment`
 * takes, so a summarised sheet or a cut document is one call from whole.
 * @param a - A loaded upload.
 */
function describe(a: LoadedAttachment): string {
  const label = formatOf({ name: a.title, type: a.contentType })?.label ?? a.contentType;
  return `${label}, ${formatBytes(a.bytes)}, file #${a.id}; read_attachment(id: ${a.id}) reads, filters or counts the whole file`;
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
 * names and ids, not the contents — the id is enough for `read_attachment`
 * to read the file again when a later question needs it.
 * @param attachments - The message's uploads.
 */
export function historyMarker(attachments: ReadonlyArray<{ title: string; id?: number }>): string {
  return attachments.length === 0 ? '' : `\n\n[Attached: ${attachments.map(a => (a.id ? `${a.title} (file #${a.id})` : a.title)).join(', ')}]`;
}

/**
 * An upload's bytes, by its stored (content-addressed) filename; null when it
 * is gone or the name is not one of ours. Exported for list intake, which
 * reads a dropped image after the turn that carried it.
 * @param filename - `spec.filename` of a `file` artifact.
 */
export async function readStoredFile(filename: string): Promise<Buffer | null> {
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
      // The container's loop writes its own header from title and type, so the
      // way to the whole file rides at the top of the text.
      out.push({ title: a.title, contentType: a.contentType, text: a.text ? `(${describe(a)})\n${a.text}` : '' });
      continue;
    }
    const bytes = a.filename ? await readImage(a.filename) : null;
    out.push({ title: a.title, contentType: a.contentType, ...(bytes ? { dataUrl: `data:${a.contentType};base64,${bytes.toString('base64')}` } : {}) });
  }
  return out;
}
