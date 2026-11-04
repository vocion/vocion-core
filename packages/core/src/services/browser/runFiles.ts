/**
 * FILES A BROWSER RUN ATTACHES: a form that wants a document (a roster, a
 * W-9, a signed letter) gets one from the run's inputs, never from the page or
 * the model's memory. An input names the file one of two ways:
 *
 *   - `artifact:<id>`: a file in the workspace. A file artifact is attached as
 *     it is; an artifact with tables (a roster built in chat) is attached as
 *     the same .xlsx its Download serves.
 *   - a web address: fetched by the app, under the browser's own rule
 *     for where it may go (`mayLoad`: public addresses, or the named hosts of
 *     `VOCION_BROWSER_ALLOW_HOSTS`).
 *
 * The model only ever names the input; the bytes go from here to the file
 * field, so a page cannot talk a run into attaching something else.
 */

import type { BrowserFile } from './browserEngine';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exportFilename, extractTables, toXlsx } from '@/libs/artifacts/tableExport';
import { artifactsDir } from '@/libs/tools/artifacts/store';
import { getArtifact } from '@/services/ArtifactService';
import { mayLoad } from './browserEngine';

/** The largest file a run attaches. */
export const RUN_FILE_MAX_BYTES = 15 * 1024 * 1024;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: XLSX,
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
};

/**
 * Whether an input's value names a file a run can attach.
 * @param value - The input's value.
 */
export function isFileRef(value: string | null | undefined): boolean {
  return Boolean(value && (/^artifact:\d+$/.test(value.trim()) || /^https?:\/\/\S+$/i.test(value.trim())));
}

function typeOf(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return TYPES[ext] ?? fallback;
}

/**
 * The file name a download gives: Content-Disposition's, else the address's last part.
 * @param url - The address.
 * @param disposition - The Content-Disposition header.
 */
export function downloadName(url: string, disposition: string | null): string {
  const m = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (m?.[1]) {
    return decodeURIComponent(m[1]).replace(/[/\\]/g, '_');
  }
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : 'file';
  } catch {
    return 'file';
  }
}

/**
 * The file an input names, or a sentence saying why there is none.
 * @param orgId - The workspace the run belongs to.
 * @param value - The input's value: `artifact:<id>` or a web address.
 * @param doFetch - The fetch to use (a test's stand-in).
 */
export async function resolveRunFile(orgId: string, value: string, doFetch: typeof fetch = fetch): Promise<BrowserFile | string> {
  const v = value.trim();
  const art = v.match(/^artifact:(\d+)$/);
  if (art) {
    const a = await getArtifact({ orgId, id: Number(art[1]) });
    if (!a) {
      return `There is no artifact #${art[1]} in this workspace.`;
    }
    const spec = (a.spec ?? {}) as { filename?: string; contentType?: string };
    if (a.kind === 'file' && spec.filename) {
      const stored = path.join(artifactsDir(), path.basename(spec.filename));
      const buffer = await readFile(stored).catch(() => null);
      if (!buffer) {
        return `The file of artifact #${art[1]} is missing from storage.`;
      }
      return { name: a.title || path.basename(spec.filename), mimeType: spec.contentType || typeOf(a.title), buffer };
    }
    const tables = extractTables({ kind: a.kind, title: a.title, spec: a.spec });
    if (tables.length === 0) {
      return `“${a.title}” is not a file and has no tables, so there is nothing to attach.`;
    }
    return { name: exportFilename(a.title, 'xlsx'), mimeType: XLSX, buffer: await toXlsx(tables) };
  }
  if (!/^https?:\/\//i.test(v)) {
    return 'A file input must be artifact:<id> or a web address.';
  }
  if (!(await mayLoad(v))) {
    return `${v} is not an address the browser may use.`;
  }
  const res = await doFetch(v, { redirect: 'error', signal: AbortSignal.timeout(20_000) }).catch((e: Error) => e);
  if (res instanceof Error) {
    return `The file at ${v} could not be fetched: ${res.message.slice(0, 120)}`;
  }
  if (!res.ok) {
    return `The file at ${v} answered ${res.status}.`;
  }
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > RUN_FILE_MAX_BYTES) {
    return `The file at ${v} is larger than ${RUN_FILE_MAX_BYTES / 1024 / 1024} MB.`;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > RUN_FILE_MAX_BYTES) {
    return `The file at ${v} is larger than ${RUN_FILE_MAX_BYTES / 1024 / 1024} MB.`;
  }
  const name = downloadName(v, res.headers.get('content-disposition'));
  const header = res.headers.get('content-type')?.split(';')[0]?.trim();
  return { name, mimeType: header && header !== 'application/octet-stream' ? header : typeOf(name), buffer };
}
