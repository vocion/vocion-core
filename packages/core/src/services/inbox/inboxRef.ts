/**
 * One decision surface, one URL shape. Every row on "Review queue" opens at
 * `/dashboard/inbox/<ref>`, and the ref says which kind of thing it is so
 * the detail route can render the right screen for it:
 *
 *   42               an ask (bare numbers stay asks — the API's `url` field
 *                    and every mailed / Slacked link have used this shape)
 *   ask-42           the same ask, spelled out
 *   proposal-123     an agent-proposed `action_run` awaiting a decision
 *   mission-5        a paused / awaiting-review `mission_run`
 *   workflow-3       a paused `workflow_run`
 *   worker-9         a paused or awaiting-review `worker_run`, or the run behind
 *                    an escalated exception
 *   learning-7       a pending `learning_candidate`
 *
 * Pure functions, no I/O — the service builds hrefs with `inboxHref`, the
 * detail page reads them back with `parseInboxRef`, and the tests hold the
 * two together.
 */

/** What a detail ref can point at. `ask` covers every ask kind; the ask row itself says which. */
export type InboxRefKind = 'ask' | 'proposal' | 'mission' | 'workflow' | 'worker' | 'learning';

export const INBOX_REF_KINDS: readonly InboxRefKind[] = ['ask', 'proposal', 'mission', 'workflow', 'worker', 'learning'];

export type InboxRef = { kind: InboxRefKind; id: number };

/**
 * The path segment for one row.
 * @param kind
 * @param id
 */
export function inboxRef(kind: InboxRefKind, id: number): string {
  return kind === 'ask' ? String(id) : `${kind}-${id}`;
}

/**
 * The detail URL for one row.
 * @param kind
 * @param id
 */
export function inboxHref(kind: InboxRefKind, id: number): string {
  return `/dashboard/inbox/${inboxRef(kind, id)}`;
}

/**
 * Read a `[id]` segment back into a ref, or null when it names nothing.
 * @param segment - The raw path segment (URL-decoded or not; refs contain no reserved characters).
 */
export function parseInboxRef(segment: string): InboxRef | null {
  const s = decodeURIComponent(segment).trim();
  if (/^\d+$/.test(s)) {
    return { kind: 'ask', id: Number.parseInt(s, 10) };
  }
  const m = s.match(/^([a-z]+)-(\d+)$/);
  if (!m) {
    return null;
  }
  const kind = m[1] as InboxRefKind;
  if (!INBOX_REF_KINDS.includes(kind)) {
    return null;
  }
  const id = Number.parseInt(m[2]!, 10);
  return Number.isSafeInteger(id) && id > 0 ? { kind, id } : null;
}
