/**
 * A version of a record, as a place a person can go (backlog 035).
 *
 * A record's history is the `record_history` preview; one version in it is
 * `record_history:<objectId>@<version>`, which opens the history with that
 * version marked. The chat's "Changed …" line links there, so the claim that
 * a record changed is one click from the version that says how.
 *
 * Pure: shared by the server (the answer's link) and the client (the pane).
 */

import type { RecordRef } from '@/services/chat/pageContext';

/**
 * The `record_history` ref id for one version: `214@5`, or `214` for the whole history.
 * @param objectId - The record.
 * @param version - The version to mark, when there is one.
 */
export function historyRefId(objectId: number, version?: number | null): string {
  return version ? `${objectId}@${version}` : String(objectId);
}

/**
 * Read a `record_history` ref id back.
 * @param id - `214` or `214@5`.
 * @returns The record and the version, or null when the id is not one.
 */
export function parseHistoryRefId(id: string): { objectId: number; version: number | null } | null {
  const m = /^(\d+)(?:@(\d+))?$/.exec(id.trim());
  if (!m) {
    return null;
  }
  const objectId = Number(m[1]);
  return objectId > 0 ? { objectId, version: m[2] ? Number(m[2]) : null } : null;
}

/**
 * The record's page with that version open in its history.
 * @param objectId - The record.
 * @param version - The version.
 */
export function versionHistoryHref(objectId: number, version: number): string {
  return `/dashboard/objects/${objectId}?preview=${encodeURIComponent(`record_history:${historyRefId(objectId, version)}`)}`;
}

/** A version a turn wrote, as the answer links it. */
export type WrittenVersion = { ref: Pick<RecordRef, 'type' | 'id' | 'label'>; to: number };

/**
 * The answer, with the version each record write made linked — the text to
 * append, so it can be streamed as a delta. When the answer's last line is
 * already a "Changed …" line, the link joins it; otherwise it is its own
 * line. A version the answer already links is not linked again. Only record
 * versions: an artifact's versions are its pane's version menu.
 * @param text - The finished answer.
 * @param versions - The versions the turn wrote, in order.
 * @returns What to append (empty when nothing is owed).
 */
export function versionLinksDelta(text: string, versions: ReadonlyArray<WrittenVersion>): string {
  // One link per record: its newest version this turn.
  const latest = new Map<string, WrittenVersion>();
  for (const v of versions) {
    if (v.ref.type === 'object' && /^\d+$/.test(v.ref.id)) {
      latest.set(v.ref.id, v);
    }
  }
  const links = [...latest.values()]
    .map(v => ({ v, href: versionHistoryHref(Number(v.ref.id), v.to) }))
    .filter(({ href }) => !text.includes(href));
  if (links.length === 0) {
    return '';
  }
  const trimmed = text.trimEnd();
  const lastLine = trimmed.split('\n').at(-1) ?? '';
  if (links.length === 1 && trimmed === text && /^\s*Changed\b/.test(lastLine)) {
    const { v, href } = links[0]!;
    return ` [Version ${v.to} in its history](${href}).`;
  }
  const lines = links.map(({ v, href }) => `Changed ${(v.ref.label ?? `record #${v.ref.id}`).replace(/[[\]]/g, '')} — [version ${v.to} in its history](${href}).`);
  return `${trimmed ? '\n\n' : ''}${lines.join('\n')}`;
}
