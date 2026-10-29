/**
 * WHAT A CITATION IS CALLED, read once on the server so the chip says it
 * before anyone opens it: a deal by its name, a mail thread by its subject.
 * A reply draft's evidence read "GMAIL thread:1a04…" and "HUBSPOT
 * deals:6400…" (2026-10-29) — handles, where the names were on this box.
 *
 * Names come from the index only (the CRM mirror through `recordLabel`, the
 * synced thread state through `replyThread`), never from the vendor: a label
 * is not worth a round trip. A citation that resolves to nothing is left out,
 * and its chip reads as its kind, as before.
 */

import { mirrorRef, resolveRecordLabels } from '@/services/records/recordLabel';

/**
 * The thread id a citation names, or null. Pure.
 * @param source - `gmail:thread:<id>` or `gmail-thread:<id>`.
 */
export function threadIdOfCitation(source: string): string | null {
  const m = /^(?:gmail:thread|gmail-thread):([\w-]+)$/i.exec(source.trim());
  return m ? m[1]! : null;
}

/**
 * Names for the citations that have one, keyed by the citation as written.
 * @param orgId - The workspace.
 * @param sources - The citations.
 */
export async function evidenceLabels(orgId: string, sources: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const crm = sources.map(s => ({ s, key: mirrorRef(s.trim()) })).filter((x): x is { s: string; key: string } => x.key !== null);
  if (crm.length > 0) {
    const names = await resolveRecordLabels(orgId, crm.map(x => x.key)).catch(() => new Map<string, string>());
    for (const { s, key } of crm) {
      const name = names.get(key);
      if (name) {
        out[s] = name;
      }
    }
  }
  const threads = sources.map(s => ({ s, id: threadIdOfCitation(s) })).filter((x): x is { s: string; id: string } => x.id !== null);
  if (threads.length > 0) {
    const { findReplyThread } = await import('@/services/mail/replyThread');
    await Promise.all(threads.map(async ({ s, id }) => {
      const thread = await findReplyThread(orgId, { threadId: id }).catch(() => null);
      if (thread?.subject) {
        out[s] = thread.subject;
      }
    }));
  }
  return out;
}
