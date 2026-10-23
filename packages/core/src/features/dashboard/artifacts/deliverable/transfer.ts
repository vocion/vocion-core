/**
 * Out and back from the pane: **Download** (PDF, PPTX or DOCX) and **Upload
 * a new version** — the client half of the deliverable routes
 * (`docs/decks.md`, "Out and back"):
 *
 *   - `GET /api/deliverables/<id>/export?format=pdf|pptx|docx` → the file, and
 *     optionally `X-Vocion-Advice` (URI-encoded): the export gate's one line
 *     of advice. The file always comes; the advice never blocks it.
 *   - `POST /api/deliverables/<id>/import` (multipart `file`, `baseVersion`)
 *     → `{ ok: true, version, changed, report, receipt }` (`changed` false:
 *     the file matched, no version written), or 409 `{ ok: false, reason,
 *     currentVersion, diff? }` when the deliverable changed in Vocion since
 *     `baseVersion`. Other refusals are `{ ok: false, reason }` (400 wrong
 *     format for the kind, 413 too large, 415 wrong file kind, 422 could not
 *     merge) and their reason is shown as is.
 */

import type { DeliverableKind } from './pages';
import type { DeliverableDiff } from '@/libs/decks/diff';
import type { ImportReportEntry } from '@/libs/decks/pptx/types';
import type { DocumentImportReport } from '@/libs/documents/docx/import';
import { diffText } from '@/libs/decks/diff';

export type ExportFormat = 'pdf' | 'pptx' | 'docx';

/**
 * The formats a kind downloads as: the PDF always, then its editable file.
 * @param kind
 */
export function exportFormats(kind: DeliverableKind): ExportFormat[] {
  return kind === 'deck' ? ['pdf', 'pptx'] : ['pdf', 'docx'];
}

/**
 * What the upload picker accepts for a kind.
 * @param kind
 */
export function importAccept(kind: DeliverableKind): string {
  return kind === 'deck'
    ? '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

export function exportHref(artifactId: number, format: ExportFormat): string {
  return `/api/deliverables/${artifactId}/export?format=${format}`;
}

export function importHref(artifactId: number): string {
  return `/api/deliverables/${artifactId}/import`;
}

/**
 * The export gate's advice, decoded; null when there is none.
 * @param header - The raw `X-Vocion-Advice` value.
 */
export function decodeAdvice(header: string | null): string | null {
  if (!header) {
    return null;
  }
  try {
    return decodeURIComponent(header).trim() || null;
  } catch {
    return header.trim() || null;
  }
}

/**
 * The filename a download is saved under: the server's, else the title.
 * @param disposition - `Content-Disposition`.
 * @param title - The deliverable's title.
 * @param format - The format asked for.
 */
export function downloadName(disposition: string | null, title: string, format: ExportFormat): string {
  const star = disposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]!.trim().replace(/^"|"$/g, ''));
    } catch { /* fall through to the plain form */ }
  }
  const plain = disposition?.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (plain) {
    return plain[1]!.trim();
  }
  const safe = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'deliverable';
  return `${safe}.${format}`;
}

/**
 * Fetch the export and hand it to the browser as a download.
 * @param artifactId - The deliverable.
 * @param format - PDF, PPTX or DOCX.
 * @param title - For the filename when the server sends none.
 * @returns The gate's advice, when it gave any.
 */
export async function downloadDeliverable(artifactId: number, format: ExportFormat, title: string): Promise<{ advice: string | null; filename: string }> {
  const res = await fetch(exportHref(artifactId, format), { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(await reasonOf(res));
  }
  const blob = await res.blob();
  const filename = downloadName(res.headers.get('Content-Disposition'), title, format);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { advice: decodeAdvice(res.headers.get('X-Vocion-Advice')), filename };
}

export type ImportReport = ImportReportEntry[] | DocumentImportReport;

export type ImportOutcome
  /** `changed` is false when the file matched the current version and no version was written. */
  = | { ok: true; version: number; changed: boolean; report: ImportReport; receipt?: string }
    | { ok: false; conflict: true; reason: string; currentVersion?: number; diff?: DeliverableDiff | string }
    | { ok: false; conflict: false; reason: string };

/**
 * Send a file back as the next version.
 * @param artifactId - The deliverable.
 * @param file - The .pptx or .docx the person picked.
 * @param baseVersion - The version they are looking at, so a stale upload is refused with the diff.
 */
export async function uploadDeliverable(artifactId: number, file: File, baseVersion: number): Promise<ImportOutcome> {
  const body = new FormData();
  body.append('file', file);
  body.append('baseVersion', String(baseVersion));
  const res = await fetch(importHref(artifactId), { method: 'POST', body, credentials: 'same-origin' });
  const json = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (res.ok && json?.ok === true) {
    return { ok: true, version: Number(json.version), changed: json.changed !== false, report: (json.report ?? []) as ImportReport, ...(typeof json.receipt === 'string' ? { receipt: json.receipt } : {}) };
  }
  const reason = typeof json?.reason === 'string' ? json.reason : typeof json?.message === 'string' ? json.message : `the upload failed (${res.status})`;
  if (res.status === 409) {
    return { ok: false, conflict: true, reason, ...(typeof json?.currentVersion === 'number' ? { currentVersion: json.currentVersion } : {}), ...(json?.diff ? { diff: json.diff as DeliverableDiff | string } : {}) };
  }
  return { ok: false, conflict: false, reason };
}

async function reasonOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { reason?: string; message?: string; error?: string };
    return json.reason ?? json.message ?? json.error ?? `the download failed (${res.status})`;
  } catch {
    return text.trim().slice(0, 200) || `the download failed (${res.status})`;
  }
}

/** Report counts the pane says in words, in this order. */
export type ReportCountKey = 'kept' | 'textEdited' | 'converted' | 'added' | 'removed' | 'moved' | 'edited' | 'unplaced';

/**
 * An import report as counts in plain words ("12 kept, 2 text edited, 1
 * added") and the first page that changed, to select.
 * @param kind - Deck or document.
 * @param report - What the route returned.
 */
export function reportSummary(kind: DeliverableKind, report: ImportReport): { counts: Array<{ key: ReportCountKey; count: number }>; firstChanged: string | null } {
  if (kind === 'deck' && Array.isArray(report)) {
    const by = (s: ImportReportEntry['status']) => report.filter(e => e.status === s).length;
    const counts = ([
      ['kept', by('kept')],
      ['textEdited', by('text-edited')],
      ['converted', by('converted')],
      ['added', by('added')],
      ['removed', by('removed')],
      ['moved', by('moved')],
    ] as Array<[ReportCountKey, number]>).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count }));
    const first = report.find(e => e.status !== 'kept' && e.status !== 'removed');
    return { counts, firstChanged: first?.slideId ?? null };
  }
  const doc = (Array.isArray(report) ? { kept: 0, edited: [], unplaced: [] } : report) as DocumentImportReport;
  const counts = ([
    ['kept', doc.kept ?? 0],
    ['edited', doc.edited?.length ?? 0],
    ['unplaced', doc.unplaced?.length ?? 0],
  ] as Array<[ReportCountKey, number]>).filter(([, n]) => n > 0).map(([key, count]) => ({ key, count }));
  const sheet = doc.edited?.[0]?.sheet;
  return { counts, firstChanged: typeof sheet === 'number' ? String(sheet) : null };
}

/**
 * What changed in Vocion since the file left, one line per page, from the 409's diff.
 * @param diff - A `DeliverableDiff`, or the route's own lines.
 */
export function conflictLines(diff: DeliverableDiff | string | undefined): string[] {
  if (!diff) {
    return [];
  }
  const text = typeof diff === 'string' ? diff : diffText(diff);
  return text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12);
}
