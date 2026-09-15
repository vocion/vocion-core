/**
 * Where the person is in the app when they ask (ticket 058).
 *
 * Off a record page the dock is the everything-scoped conversation, but the
 * person is still looking at something: the review queue, the personalization
 * list, an agent's page. The client sends that as `page_context` with each
 * turn and the model reads it as a note under the message, so an unqualified
 * question ("what is waiting?") is answered about the page rather than about
 * the whole workspace. The persisted transcript keeps the raw message; the
 * note is for the model only, and a scoped dock (a lead page) never sends one.
 */

export type PageContext = { path: string; title: string };

/**
 * A record the person tagged in the composer (`@team`, `@mission`, a deal…),
 * sent as `context_refs` beside the message. Mirrors the client's
 * `ContextRef` minus its routing hint. NOTE for the #329 merge: that PR gives
 * `PageContext` a `refs` field with the same intent — fold these into it and
 * drop this parallel shape.
 */
export type RecordRef = { type: string; id: string; label: string };

const MAX = 200;
/** Tags per turn — the composer caps its own autocomplete at 12 hits. */
const MAX_REFS = 12;

/**
 * Validate the client's `context_refs`: an array of short `{ type, id, label }`
 * records, or nothing. Malformed entries are dropped one by one — a bad tag
 * never fails the turn.
 * @param raw - `body.context_refs` as posted.
 */
export function readContextRefs(raw: unknown): RecordRef[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: RecordRef[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const { type, id, label } = item as Record<string, unknown>;
    if (typeof type !== 'string' || typeof id !== 'string' || typeof label !== 'string') {
      continue;
    }
    const t = type.trim().slice(0, MAX);
    const i = id.trim().slice(0, MAX);
    if (!t || !i) {
      continue;
    }
    out.push({ type: t, id: i, label: label.trim().slice(0, MAX) });
    if (out.length >= MAX_REFS) {
      break;
    }
  }
  return out;
}

/**
 * Validate the client's `page_context`: two short strings, or nothing.
 * Anything else (missing, wrong shape, empty, oversized) reads as no context,
 * never as an error, because the message itself is still fine to answer.
 * @param raw - `body.page_context` as posted.
 */
export function readPageContext(raw: unknown): PageContext | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { path, title } = raw as Record<string, unknown>;
  if (typeof path !== 'string' || typeof title !== 'string') {
    return null;
  }
  const p = path.trim().slice(0, MAX);
  const t = title.trim().slice(0, MAX);
  if (!p) {
    return null;
  }
  return { path: p, title: t };
}

/**
 * The message as the model sees it: the person's words, then where they are,
 * then what they tagged. Both notes are for the model only; the transcript
 * keeps the raw message.
 * @param message - What the person typed.
 * @param ctx - The page they are on, or null for a scoped or full-page chat.
 * @param refs - Records tagged in the composer (`context_refs`), if any.
 */
export function withPageContext(message: string, ctx: PageContext | null, refs: RecordRef[] = []): string {
  let out = message;
  if (ctx) {
    const where = ctx.title ? `"${ctx.title}" (${ctx.path})` : ctx.path;
    out = `${out}\n\n--- where I am ---\nI am looking at ${where} in the app. Unless I say otherwise, take my question to be about what that page shows.`;
  }
  if (refs.length > 0) {
    const lines = refs.map(r => `- ${r.type} "${r.label || r.id}" (${r.type}:${r.id})`).join('\n');
    out = `${out}\n\n--- records I tagged ---\nMy question is about these specifically; look them up rather than guessing:\n${lines}`;
  }
  return out;
}
